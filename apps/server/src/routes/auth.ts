import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { prisma } from '../prisma'
import { authenticate } from '../middleware/auth'
import { LoginRequest, JwtPayload, UserRole } from '@oi-manager/shared'
import { validateUsername, validatePassword, validatePhone, validateEmail } from '../utils/validation'
import { getJwtSecret } from '../lib/jwtSecret'
import { loginLimiter, registerLimiter, passwordLimiter } from '../middleware/rateLimiter'
import logger from '../lib/logger'
import { updateRequestContext } from '../middleware/requestLogger'
import { fileService } from '../lib/storage'
import { STORAGE_ROOT } from '../config/storage'

/**
 * 获取客户端 IP 地址
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

/**
 * 获取 User-Agent
 */
function getUserAgent(req: Request): string {
  return req.headers['user-agent'] || 'unknown'
}

// 配置头像上传（临时目录）
const tempAvatarDir = path.join(STORAGE_ROOT, 'temp/uploads')
if (!fs.existsSync(tempAvatarDir)) {
  fs.mkdirSync(tempAvatarDir, { recursive: true })
}

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempAvatarDir)
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
authRouter.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password, role } = req.body as { username: string; password: string; role: 'admin' | 'teacher' | 'student' }
    const clientIp = getClientIp(req)
    const userAgent = getUserAgent(req)

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { username },
      include: {
        Student: true,
        Teacher: true,
        Admin: true
      }
    })

    if (!user) {
      // 记录登录失败 - 用户不存在
      await prisma.loginLog.create({
        data: {
          id: crypto.randomUUID(),
          username,
          loginRole: role || 'unknown',
          result: 'failed_user_not_found',
          failureReason: '用户名不存在',
          ipAddress: clientIp,
          userAgent
        }
      })
      logger.security('login_failed_user_not_found', {
        action: 'login',
        target: username,
        metadata: { loginRole: role, ip: clientIp }
      })
      return res.status(401).json({ success: false, message: '用户名或密码错误' })
    }

    // 验证密码
    const validPassword = await bcrypt.compare(password, user.passwordHash)
    if (!validPassword) {
      // 记录登录失败 - 密码错误
      await prisma.loginLog.create({
        data: {
          id: crypto.randomUUID(),
          username,
          loginRole: role || 'unknown',
          userRole: user.role,
          result: 'failed_wrong_password',
          failureReason: '密码错误',
          ipAddress: clientIp,
          userAgent
        }
      })
      logger.security('login_failed_wrong_password', {
        action: 'login',
        target: username,
        metadata: { loginRole: role, userRole: user.role, ip: clientIp }
      })
      return res.status(401).json({ success: false, message: '用户名或密码错误' })
    }

    // 检查用户状态
    if (user.status === 'disabled') {
      // 记录登录失败 - 账号禁用
      await prisma.loginLog.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          username,
          loginRole: role || 'unknown',
          userRole: user.role,
          result: 'failed_account_disabled',
          failureReason: '账号已被禁用',
          ipAddress: clientIp,
          userAgent
        }
      })
      logger.security('login_failed_account_disabled', {
        action: 'login',
        userId: user.id,
        target: username,
        metadata: { userRole: user.role, ip: clientIp }
      })
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
      // 记录登录失败 - 角色不匹配
      await prisma.loginLog.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          username,
          loginRole: role || 'unknown',
          userRole: user.role,
          result: 'failed_role_mismatch',
          failureReason: `用户角色 ${user.role} 与登录端 ${role} 不匹配`,
          ipAddress: clientIp,
          userAgent
        }
      })
      logger.security('login_failed_role_mismatch', {
        action: 'login',
        userId: user.id,
        target: username,
        metadata: { userRole: user.role, loginRole: role, ip: clientIp }
      })

      if (adminRoles.includes(user.role)) {
        return res.status(401).json({ success: false, message: '请选择管理员端登录' })
      } else if (teacherRoles.includes(user.role)) {
        return res.status(401).json({ success: false, message: '请选择教师端登录' })
      } else if (user.role === 'student') {
        return res.status(401).json({ success: false, message: '请选择学生端登录' })
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
    if (user.Admin) {
      payload.adminId = user.Admin.id
      // 系统管理员也有 schoolId（绑定到平台学校）
      payload.schoolId = user.schoolId
    }

    // 如果是教师或学校负责人，添加 teacherId
    if (user.Teacher) {
      payload.teacherId = user.Teacher.id
      payload.schoolId = user.schoolId
    }

    // 如果是学生，添加 studentId
    if (user.Student) {
      payload.studentId = user.Student.id
      payload.schoolId = user.schoolId
    }

    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' })

    // 记录登录成功
    await prisma.loginLog.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        username,
        loginRole: role || 'unknown',
        userRole: user.role,
        result: 'success',
        ipAddress: clientIp,
        userAgent
      }
    })

    // 更新请求日志上下文（用于后续日志）
    updateRequestContext(req, user.id, user.role)

    logger.audit('login_success', {
      userId: user.id,
      target: username,
      metadata: { userRole: user.role, loginRole: role, ip: clientIp }
    })

    res.json({
      success: true,
      data: {
        token,
        userId: user.id,
        role: user.role,
        username: user.username,
        avatar: user.avatar,
        adminId: user.Admin?.id,
        teacherId: user.Teacher?.id,
        studentId: user.Student?.id,
        schoolId: user.schoolId // 所有用户都有 schoolId
      }
    })
  } catch (error) {
    logger.error('login_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 注册 (仅限学生角色)
authRouter.post('/register', registerLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password, role, name, schoolId, headTeacherId } = req.body as {
      username: string
      password: string
      role?: string
      name: string
      schoolId?: string
      headTeacherId?: string
    }

    // 限制只能注册学生角色
    if (role && role !== 'student') {
      return res.status(400).json({ success: false, message: '开放注册仅限学生角色，其他角色请联系管理员创建' })
    }

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

    // 学生注册需要 schoolId
    if (!schoolId) {
      return res.status(400).json({ success: false, message: '请提供学校信息' })
    }

    // 密码加密
    const passwordHash = await bcrypt.hash(password, 10)

    // 创建用户（强制为学生角色，必须有 schoolId）
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: 'student',
        schoolId, // 所有用户必须绑定学校
        Student: {
          create: {
            name,
            schoolId,
            ...(headTeacherId ? { headTeacherId } : {})
          }
        }
      }
    })

    res.json({ success: true, data: { userId: user.id } })
  } catch (error) {
    logger.error('register_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取当前用户信息
authRouter.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId  // JWT payload 使用 userId 字段

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        Student: true,
        Teacher: true,
        Admin: true
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
    if (user.schoolId) {
      const school = await prisma.school.findUnique({
        where: { id: user.schoolId },
        select: { id: true, name: true }
      })
      if (school) {
        schoolInfo = school
      }
    }

    // 构建 profile 对象（只返回基本字段，不含关联对象）
    let profileData = null
    if (user.Student) {
      profileData = {
        id: user.Student.id,
        name: user.Student.name,
        gender: user.Student.gender,
        avatar: user.Student.avatar,
        rating: user.Student.rating,
        enrollmentYear: user.Student.enrollmentYear
      }
    } else if (user.Teacher) {
      profileData = {
        id: user.Teacher.id,
        name: user.Teacher.name,
        avatar: user.Teacher.avatar,
        bio: user.Teacher.bio,
        title: user.Teacher.title
      }
    } else if (user.Admin) {
      profileData = {
        id: user.Admin.id,
        name: user.Admin.name
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
        profile: profileData,
        adminId: user.Admin?.id,
        teacherId: user.Teacher?.id,
        studentId: user.Student?.id,
        schoolId: user.schoolId, // 所有用户都有 schoolId
        schoolName: schoolInfo?.name
      }
    })
  } catch {
    res.status(401).json({ success: false, message: 'Token 无效' })
  }
})

// 更新当前用户资料
authRouter.put('/profile', authenticate, async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as JwtPayload
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
    if (decoded.role === 'student') {
      await prisma.student.update({
        where: { id: decoded.userId },
        data: { name }
      })
    } else if (decoded.role === 'teacher' || decoded.role === 'school_principal') {
      await prisma.teacher.update({
        where: { id: decoded.userId },
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
    logger.error('update_profile_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 上传头像
authRouter.post('/avatar', authenticate, avatarUpload.single('avatar'), async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as JwtPayload

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传图片文件' })
    }

    // 使用 FileService 上传文件
    const result = await fileService.uploadFromMulter(req.file, {
      category: 'avatar',
      ownerType: 'user',
      ownerId: decoded.userId,
      isPublic: true
    })

    // 生成公开访问 URL
    const avatarUrl = `/api/files/${result.id}/public`

    // 更新用户头像
    await prisma.user.update({
      where: { id: decoded.userId },
      data: { avatar: avatarUrl }
    })

    // 同步更新 Teacher 或 Student 表的头像
    if (decoded.role === 'teacher' || decoded.role === 'school_principal') {
      await prisma.teacher.update({
        where: { id: decoded.userId },
        data: { avatar: avatarUrl }
      })
    } else if (decoded.role === 'student') {
      await prisma.student.update({
        where: { id: decoded.userId },
        data: { avatar: avatarUrl }
      })
    }

    logger.audit('avatar_uploaded', {
      userId: decoded.userId,
      action: 'upload_avatar',
      metadata: { fileId: result.id, originalName: result.originalName }
    })

    res.json({
      success: true,
      data: {
        avatar: avatarUrl,
        fileId: result.id
      }
    })
  } catch (error) {
    // 清理临时文件
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    logger.error('upload_avatar_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 修改密码
authRouter.put('/password', passwordLimiter, authenticate, async (req: Request, res: Response) => {
  try {
    const decoded = (req as any).user as JwtPayload
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

    // 记录密码修改审计日志
    logger.audit('password_change_success', {
      userId: decoded.userId,
      action: 'password_change',
      metadata: { userRole: decoded.role }
    })

    res.json({
      success: true,
      message: '密码修改成功'
    })
  } catch (error) {
    logger.error('change_password_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
