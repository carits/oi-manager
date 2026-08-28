import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { JwtPayload, UserRole } from '@oi-manager/shared'
import { authenticate } from '../middleware/auth'
import { validateUsername, validatePassword, validatePhone, validateEmail } from '../utils/validation'
import { getJwtSecret } from '../lib/jwtSecret'
import { clearSessionCookie, setSessionCookie } from '../lib/sessionCookie'
import { loginLimiter, registerLimiter, passwordLimiter } from '../middleware/rateLimiter'
import logger from '../lib/logger'
import { updateRequestContext } from '../middleware/requestLogger'
import {
  changeAccountPassword,
  loadCurrentAccount,
  loginAccount,
  registerPersonalAccount,
  resolveWorkspaceSwitch,
  updateAccountProfile,
  uploadAccountAvatar,
  type WorkspaceMode,
} from '../modules/auth/auth-account.service'
import {
  avatarUpload,
  cleanupAvatarTemporaryFile,
} from '../modules/auth/auth-avatar-upload'

export const authRouter = Router()

function clientIp(req: Request) {
  const forwarded = req.headers['x-forwarded-for']
  return typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : (req.socket?.remoteAddress || 'unknown')
}

function workspaceMode(value: unknown): WorkspaceMode | null {
  if (value === undefined || value === null || value === '' || value === 'campus' || value === 'work') return 'work'
  return value === 'personal' ? 'personal' : null
}

function renewablePayload(payload: JwtPayload): JwtPayload {
  const { iat: _iat, exp: _exp, ...claims } = payload as JwtPayload & { iat?: number; exp?: number }
  return claims
}

function issueToken(res: Response, payload: JwtPayload) {
  const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' })
  setSessionCookie(res, token)
  return token
}

authRouter.post('/login', loginLimiter, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!username || !password) return res.status(400).json({ success: false, message: '请输入用户名和密码' })
    if (username.length > 64 || password.length > 256) {
      return res.status(400).json({ success: false, message: '用户名或密码格式无效' })
    }
    const requestedMode = workspaceMode(body.workspaceMode ?? body.mode)
    if (!requestedMode) return res.status(400).json({ success: false, message: '无效的工作区模式' })
    const result = await loginAccount({
      username, password, workspaceMode: requestedMode,
      ipAddress: clientIp(req), userAgent: req.headers['user-agent'] || 'unknown',
    })
    if (!result.ok) {
      logger.security('login_failed', { action: 'login', target: username, metadata: { ip: clientIp(req) } })
      return res.status(401).json({ success: false, message: result.message })
    }
    const token = issueToken(res, {
      userId: result.user.id,
      role: result.role,
      username: result.user.username,
      workspaceMode: result.workspaceMode,
    })
    updateRequestContext(req, result.user.id, result.user.role)
    logger.audit('login_success', {
      userId: result.user.id, action: 'login', target: username,
      metadata: { userRole: result.user.role, loginMode: 'unified', ip: clientIp(req) },
    })
    res.json({
      success: true,
      data: {
        token,
        userId: result.user.id,
        role: result.role,
        username: result.user.username,
        workspaceMode: result.workspaceMode,
        schoolId: result.schoolId,
        avatar: result.user.avatar,
        next: result.isGlobalAdmin ? (result.role === 'super_admin' ? '/admin' : '/platform-admin') : '/identity',
      },
    })
  } catch (error) {
    logger.error('login_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

authRouter.post('/register', registerLimiter, async (req, res) => {
  try {
    const { username, password, role } = req.body || {}
    if (role && role !== 'student') return res.status(400).json({ success: false, message: '仅支持注册学生账号' })
    const usernameCheck = validateUsername(username)
    if (!usernameCheck.valid) return res.status(400).json({ success: false, message: usernameCheck.message })
    const passwordCheck = validatePassword(password)
    if (!passwordCheck.valid) return res.status(400).json({ success: false, message: passwordCheck.message })
    const user = await registerPersonalAccount(username, password)
    if (!user) return res.status(400).json({ success: false, message: '用户名已存在' })
    const token = issueToken(res, {
      userId: user.id, role: 'user' as UserRole, username: user.username, workspaceMode: 'personal',
    })
    res.status(200).json({
      success: true, data: { userId: user.id, token, workspaceMode: 'personal', next: '/personal' },
    })
  } catch (error) {
    logger.error('register_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

authRouter.get('/me', authenticate, async (req, res) => {
  try {
    const payload = (req as any).user as JwtPayload
    const result = await loadCurrentAccount(payload.userId, payload.organizationId)
    if (result.status === 'missing') return res.status(404).json({ success: false, message: '用户不存在' })
    if (result.status === 'disabled') return res.status(401).json({ success: false, message: '该账号已被禁用' })
    const { user, membership } = result
    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        role: result.isGlobalAdmin ? user.role : (membership?.memberRole || user.role),
        avatar: user.avatar,
        phone: user.phone,
        email: user.email,
        bio: user.bio,
        organizationId: result.organizationId || undefined,
        organizationMembershipId: membership?.id,
        organizationRole: membership?.memberRole,
        schoolId: result.schoolId,
        workspaceMode: result.isGlobalAdmin ? 'work' : (payload.workspaceMode === 'personal' ? 'personal' : 'work'),
        profile: result.profile,
      },
    })
  } catch {
    res.status(401).json({ success: false, message: 'Token 无效' })
  }
})

authRouter.post('/switch-workspace', authenticate, async (req, res) => {
  const requestedMode = req.body?.workspaceMode ?? req.body?.mode
  const mode: WorkspaceMode | null = requestedMode === 'work' || requestedMode === 'personal' ? requestedMode : null
  if (!mode) {
    return res.status(400).json({ success: false, message: '无效的工作区模式' })
  }
  try {
    const payload = (req as any).user as JwtPayload
    if (mode === 'personal' && ['super_admin', 'platform_admin'].includes(payload.role)) {
      return res.status(403).json({ success: false, message: '管理员不具备个人工作区' })
    }
    const role = await resolveWorkspaceSwitch(payload.userId, payload.role, mode)
    const token = issueToken(res, { ...renewablePayload(payload), role: role as UserRole, workspaceMode: mode })
    res.json({ success: true, data: { token, workspaceMode: mode, role } })
  } catch (error) {
    logger.error('switch_workspace_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

authRouter.post('/session/migrate', authenticate, (req, res) => {
  issueToken(res, renewablePayload((req as any).user as JwtPayload))
  res.json({ success: true })
})

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res)
  res.json({ success: true })
})

authRouter.put('/profile', authenticate, async (req, res) => {
  try {
    const { avatar, phone, email, bio, name } = req.body || {}
    if (phone) {
      const check = validatePhone(phone)
      if (!check.valid) return res.status(400).json({ success: false, message: check.message })
    }
    if (email) {
      const check = validateEmail(email)
      if (!check.valid) return res.status(400).json({ success: false, message: check.message })
    }
    const user = await updateAccountProfile((req as any).user, { avatar, phone, email, bio, name })
    res.json({
      success: true,
      data: {
        userId: user.id, username: user.username, role: user.role, avatar: user.avatar,
        phone: user.phone, email: user.email, bio: user.bio,
      },
    })
  } catch (error) {
    logger.error('update_profile_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

authRouter.post('/avatar', authenticate, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '请上传图片文件' })
    const result = await uploadAccountAvatar((req as any).user, req.file)
    logger.audit('avatar_uploaded', {
      userId: (req as any).user.userId,
      action: 'upload_avatar',
      metadata: { fileId: result.fileId, originalName: result.originalName },
    })
    res.json({ success: true, data: { avatar: result.avatar, fileId: result.fileId } })
  } catch (error) {
    cleanupAvatarTemporaryFile(req.file)
    logger.error('upload_avatar_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

authRouter.put('/password', passwordLimiter, authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {}
    if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: '请填写完整信息' })
    const check = validatePassword(newPassword)
    if (!check.valid) return res.status(400).json({ success: false, message: check.message })
    const result = await changeAccountPassword((req as any).user.userId, currentPassword, newPassword)
    if (!result.ok) return res.status(result.statusCode).json({ success: false, message: result.message })
    res.json({ success: true, message: '密码修改成功' })
  } catch (error) {
    logger.error('change_password_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
