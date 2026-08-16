import crypto from 'crypto'
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
import { clearSessionCookie, setSessionCookie } from '../lib/sessionCookie'
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

function renewablePayload(payload: JwtPayload): JwtPayload {
  const { iat: _issuedAt, exp: _expiresAt, ...claims } = payload as JwtPayload & {
    iat?: number
    exp?: number
  }
  return claims
}

authRouter.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body as { username: string; password: string }
    const clientIp = getClientIp(req)
    const userAgent = getUserAgent(req)

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { username },

    })

    if (!user) {
      // 记录登录失败 - 用户不存在
      await prisma.loginLog.create({
        data: {
          id: crypto.randomUUID(),
          username,
          loginRole: 'unified',
          result: 'failed_user_not_found',
          failureReason: '用户名不存在',
          ipAddress: clientIp,
          userAgent
        }
      })
      logger.security('login_failed_user_not_found', {
        action: 'login',
        target: username,
        metadata: { ip: clientIp }
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
          loginRole: 'unified',
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
        metadata: { userRole: user.role, ip: clientIp }
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
          loginRole: 'unified',
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

    // 生成 token
    const payload: JwtPayload = {
      userId: user.id,
      role: user.role as UserRole,
      username: user.username
    }

    await prisma.personalProfile.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} })

    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' })
    setSessionCookie(res, token)

    // 记录登录成功
    await prisma.loginLog.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        username,
        loginRole: 'unified',
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
      metadata: { userRole: user.role, loginMode: 'unified', ip: clientIp }
    })

    res.json({
      success: true,
      data: {
        token,
        userId: user.id,
        role: user.role,
        username: user.username,
        avatar: user.avatar,

        next: '/identity'
      }
    })
  } catch (error) {
    logger.error('login_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 注册只创建全局个人账号；加入校园必须经过组织邀请或管理流程。
authRouter.post('/register', registerLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body as { username: string; password: string }
    const usernameValidation = validateUsername(username)
    if (!usernameValidation.valid) return res.status(400).json({ success: false, message: usernameValidation.message })
    const passwordValidation = validatePassword(password)
    if (!passwordValidation.valid) return res.status(400).json({ success: false, message: passwordValidation.message })
    const existing = await prisma.user.findUnique({ where: { username } })
    if (existing) return res.status(400).json({ success: false, message: '用户名已存在' })

    const user = await prisma.user.create({ data: {
      id: crypto.randomUUID(), username, passwordHash: await bcrypt.hash(password, 10), role: 'user',
    } })
    await prisma.personalProfile.create({ data: { userId: user.id } })
    const token = jwt.sign({ userId: user.id, role: 'user', username: user.username }, getJwtSecret(), { expiresIn: '7d' })
    setSessionCookie(res, token)
    res.status(201).json({ success: true, data: { userId: user.id, token, next: '/personal' } })
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

    })

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' })
    }

    // 检查用户状态
    if (user.status === 'disabled') {
      return res.status(401).json({ success: false, message: '该账号已被禁用' })
    }

    const organizationId = (req as any).user?.organizationId as string | undefined
    const membership = organizationId
      ? await prisma.organizationMembership.findFirst({
        where: { organizationId, userId, status: 'active' },
        include: { StudentProfile: true, TeacherProfile: true }
      })
      : null

    // 个人请求不读取组织档案；组织请求只读取当前成员关系。
    let profileData = null
    if (membership?.StudentProfile) {
      profileData = {
        id: membership.StudentProfile.id,
        name: membership.StudentProfile.name,
        avatar: membership.StudentProfile.avatar,
        rating: membership.StudentProfile.rating,
        enrollmentYear: membership.StudentProfile.enrollmentYear
      }
    } else if (membership?.TeacherProfile) {
      profileData = {
        id: membership.TeacherProfile.id,
        name: membership.TeacherProfile.name,
        avatar: membership.TeacherProfile.avatar,
        organizationRole: membership?.memberRole,
        title: membership.TeacherProfile.title
      }
    } else if (['platform_admin', 'super_admin'].includes(user.role)) {
      profileData = { id: user.id, name: user.username }
    }

    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        // 组织页面返回成员身份；个人与平台请求仍返回全局账号权限。
        role: organizationId && membership ? membership.memberRole : user.role,
        avatar: user.avatar,
        phone: user.phone,
        email: user.email,
        bio: user.bio,
        organizationId: organizationId || undefined,
        organizationMembershipId: membership?.id,
        organizationRole: membership?.memberRole,
        profile: profileData,
      }
    })
  } catch {
    res.status(401).json({ success: false, message: 'Token 无效' })
  }
})

// Upgrade an existing Bearer session to an HttpOnly cookie without forcing a new login.
authRouter.post('/session/migrate', authenticate, async (req: Request, res: Response) => {
  const payload = (req as any).user as JwtPayload
  const token = jwt.sign(renewablePayload(payload), getJwtSecret(), { expiresIn: '7d' })
  setSessionCookie(res, token)
  res.json({ success: true })
})

authRouter.post('/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res)
  res.json({ success: true })
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

    if (decoded.organizationMembershipId && typeof name === 'string') {
      const membership = await prisma.organizationMembership.findFirst({ where: { id: decoded.organizationMembershipId, userId: decoded.userId, status: 'active' }, select: { memberRole: true } })
      if (membership?.memberRole === 'student') {
        await prisma.organizationStudentProfile.updateMany({ where: { membershipId: decoded.organizationMembershipId }, data: { name } })
      } else if (membership) {
        await prisma.organizationTeacherProfile.updateMany({ where: { membershipId: decoded.organizationMembershipId }, data: { name, bio } })
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

    if (decoded.organizationMembershipId) {
      const membership = await prisma.organizationMembership.findFirst({ where: { id: decoded.organizationMembershipId, userId: decoded.userId, status: 'active' }, select: { memberRole: true } })
      if (membership?.memberRole === 'student') {
        await prisma.organizationStudentProfile.updateMany({ where: { membershipId: decoded.organizationMembershipId }, data: { avatar: avatarUrl } })
      } else if (membership) {
        await prisma.organizationTeacherProfile.updateMany({ where: { membershipId: decoded.organizationMembershipId }, data: { avatar: avatarUrl } })
      }
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
