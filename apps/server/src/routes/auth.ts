import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { prisma } from '../prisma'
import { authenticate } from '../middleware/auth'
import { LoginRequest, JwtPayload, UserRole } from '../../../../packages/shared/src'
import { validateUsername, validatePassword, validatePhone, validateEmail } from '../utils/validation'

// 配置头像上传
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/avatars')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
})

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase())
    const mimetype = allowedTypes.test(file.mimetype)
    if (extname && mimetype) {
      cb(null, true)
    } else {
      cb(new Error('只支持图片文件'))
    }
  }
})

export const authRouter = Router()

// 登录
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password, role } = req.body as LoginRequest

    console.log('Login attempt:', username, 'role:', role, 'req.body:', req.body)

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        student: true,
        teacher: true,
        admin: true
      }
    })

    if (!user) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' })
    }

    // 验证密码
    const validPassword = await bcrypt.compare(password, user.passwordHash)
    if (!validPassword) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' })
    }

    // 检查用户状态
    if (user.status === 'disabled') {
      return res.status(401).json({ success: false, message: '该账号已被禁用，请联系管理员' })
    }

    // 验证角色
    // 管理员端: super_admin, platform_admin
    // 教师端: school_principal, teacher
    // 学生端: student
    const adminRoles = ['super_admin', 'platform_admin']
    const teacherRoles = ['school_principal', 'teacher']

    // 检查角色匹配
    let roleMatched = false
    if (role === 'admin' && adminRoles.includes(user.role)) {
      roleMatched = true
    } else if (role === 'teacher' && teacherRoles.includes(user.role)) {
      roleMatched = true
    } else if (role === 'student' && user.role === 'student') {
      roleMatched = true
    }

    if (!roleMatched) {
      if (adminRoles.includes(user.role)) {
        return res.status(401).json({ success: false, message: '请选择管理员端登录' })
      } else if (teacherRoles.includes(user.role)) {
        return res.status(401).json({ success: false, message: '请选择教师端登录' })
      } else if (user.role === 'student') {
        return res.status(401).json({ success: false, message: '请选择学生端���录' })
      } else {
        return res.status(401).json({ success: false, message: '角色选择错误' })
      }
    }

    // 生成 token
    const payload: JwtPayload = {
      userId: user.id,
      role: user.role as UserRole,
      username: user.username
    }

    // 如果是管理员，添加 adminId
    if (user.admin) {
      payload.adminId = user.admin.id
    }

    // 如果是教师或学校负责人，添加 teacherId
    if (user.teacher) {
      payload.teacherId = user.teacher.id
      // 所有教师都添加 schoolId（如果有的话）
      if (user.teacher.schoolId) {
        payload.schoolId = user.teacher.schoolId
      }
    }

    // 如果是学生，添加 studentId 和 schoolId
    if (user.student) {
      payload.studentId = user.student.id
      if (user.student.schoolId) {
        payload.schoolId = user.student.schoolId
      }
    }

    const secret = process.env.JWT_SECRET || 'dev-secret-key-12345'
    const token = jwt.sign(payload, secret, { expiresIn: '7d' })

    res.json({
      success: true,
      data: {
        token,
        userId: user.id,
        role: user.role,
        username: user.username,
        adminId: user.admin?.id,
        teacherId: user.teacher?.id,
        studentId: user.student?.id,
        schoolId: user.teacher?.schoolId || user.student?.schoolId || undefined
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 注册 (仅老师)
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, role, name } = req.body

    // 验证用户名
    const usernameValidation = validateUsername(username)
    if (!usernameValidation.valid) {
      return res.status(400).json({ success: false, message: usernameValidation.message })
    }

    // 验证密码
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) {
      return res.status(400).json({ success: false, message: passwordValidation.message })
    }

    // 检查用户是否存在
    const existing = await prisma.user.findUnique({ where: { username } })
    if (existing) {
      return res.status(400).json({ success: false, message: '用户名已存在' })
    }

    // 密码加密
    const passwordHash = await bcrypt.hash(password, 10)

    // 创建用户
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role,
        [role === 'teacher' ? 'teacher' : 'student']: {
          create: { name }
        }
      }
    })

    res.json({ success: true, data: { userId: user.id } })
  } catch (error) {
    console.error('Register error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取当前用户信息
authRouter.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ success: false, message: '未授权' })
    }

    const token = authHeader.substring(7)
    const secret = process.env.JWT_SECRET || 'dev-secret-key-12345'
    const decoded = jwt.verify(token, secret) as JwtPayload

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        student: true,
        teacher: true,
        admin: true
      }
    })

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' })
    }

    // 检查用户状态
    if (user.status === 'disabled') {
      return res.status(401).json({ success: false, message: '该账号已被禁用' })
    }

    // 如果是教师，获取学校信息
    let schoolInfo = null
    const userSchoolId = user.teacher?.schoolId || user.student?.schoolId
    if (userSchoolId) {
      const school = await prisma.school.findUnique({
        where: { id: userSchoolId },
        select: { id: true, name: true }
      })
      if (school) {
        schoolInfo = school
      }
    }

    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        role: user.role,
        avatar: user.avatar,
        phone: user.phone,
        email: user.email,
        bio: user.bio,
        profile: user.student || user.teacher || user.admin,
        adminId: user.admin?.id,
        teacherId: user.teacher?.id,
        studentId: user.student?.id,
        schoolId: userSchoolId,
        schoolName: schoolInfo?.name
      }
    })
  } catch {
    res.status(401).json({ success: false, message: 'Token 无效' })
  }
})

// 更新当前用户资料
authRouter.put('/profile', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ success: false, message: '未授权' })
    }

    const token = authHeader.substring(7)
    const secret = process.env.JWT_SECRET || 'dev-secret-key-12345'
    const decoded = jwt.verify(token, secret) as JwtPayload

    const { avatar, phone, email, bio, name } = req.body

    // 验证手机号
    if (phone) {
      const phoneValidation = validatePhone(phone)
      if (!phoneValidation.valid) {
        return res.status(400).json({ success: false, message: phoneValidation.message })
      }
    }

    // 验证邮箱
    if (email) {
      const emailValidation = validateEmail(email)
      if (!emailValidation.valid) {
        return res.status(400).json({ success: false, message: emailValidation.message })
      }
    }

    // 更新User表
    const user = await prisma.user.update({
      where: { id: decoded.userId },
      data: {
        avatar,
        phone,
        email,
        bio
      }
    })

    // 根据角色更新对应的profile表
    if (decoded.role === 'student' && user.student) {
      await prisma.student.update({
        where: { userId: decoded.userId },
        data: { name }
      })
    } else if (decoded.role === 'teacher' && user.teacher) {
      await prisma.teacher.update({
        where: { userId: decoded.userId },
        data: { name, bio }
      })
    }

    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        role: user.role,
        avatar: user.avatar,
        phone: user.phone,
        email: user.email,
        bio: user.bio
      }
    })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 上传头像
authRouter.post('/avatar', authenticate, avatarUpload.single('avatar'), async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ success: false, message: '未授权' })
    }

    const token = authHeader.substring(7)
    const secret = process.env.JWT_SECRET || 'dev-secret-key-12345'
    const decoded = jwt.verify(token, secret) as JwtPayload

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传图片文件' })
    }

    // 更新用户头像
    const avatarUrl = `/uploads/avatars/${req.file.filename}`
    const user = await prisma.user.update({
      where: { id: decoded.userId },
      data: { avatar: avatarUrl }
    })

    // 同步更新 Teacher 或 Student 表的头像
    if (decoded.role === 'teacher' || decoded.role === 'school_principal') {
      await prisma.teacher.update({
        where: { userId: decoded.userId },
        data: { avatar: avatarUrl }
      })
    } else if (decoded.role === 'student') {
      await prisma.student.update({
        where: { userId: decoded.userId },
        data: { avatar: avatarUrl }
      })
    }

    res.json({
      success: true,
      data: {
        avatar: avatarUrl
      }
    })
  } catch (error) {
    console.error('Upload avatar error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 修改密码
authRouter.put('/password', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader) {
      return res.status(401).json({ success: false, message: '未授权' })
    }

    const token = authHeader.substring(7)
    const secret = process.env.JWT_SECRET || 'dev-secret-key-12345'
    const decoded = jwt.verify(token, secret) as JwtPayload

    const { currentPassword, newPassword } = req.body

    // 验证参数
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '请填写完整信息' })
    }

    // 验证新密码格式
    const passwordValidation = validatePassword(newPassword)
    if (!passwordValidation.valid) {
      return res.status(400).json({ success: false, message: passwordValidation.message })
    }

    // 获取用户
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    })

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' })
    }

    // 验证当前密码
    const validPassword = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!validPassword) {
      return res.status(400).json({ success: false, message: '当前密码错误' })
    }

    // 新密码不能与当前密码相同
    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: '新密码不能与当前密码相同' })
    }

    // 更新密码
    const passwordHash = await bcrypt.hash(newPassword, 10)
    await prisma.user.update({
      where: { id: decoded.userId },
      data: { passwordHash }
    })

    res.json({
      success: true,
      message: '密码修改成功'
    })
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
