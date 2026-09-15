import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import type { JwtPayload, SessionJwtPayload, UserRole } from '@oi-manager/shared'
import {
  accountRoleFromLegacy,
  AuthContracts,
  LoginRequestSchema,
  LoginResponseDataSchema,
  PasswordChangeSchema,
  ProfileUpdateSchema,
  RegisterRequestSchema,
} from '@oi-manager/contracts'
import { authenticate } from '../middleware/auth'
import { validateUsername, validatePassword, validatePhone, validateEmail } from '../utils/validation'
import { getJwtSecret } from '../lib/jwtSecret'
import { clearSessionCookie, setSessionCookie } from '../lib/sessionCookie'
import { loginAccountLimiter, loginIpLimiter, registerLimiter, passwordLimiter } from '../middleware/rateLimiter'
import logger from '../lib/logger'
import { updateRequestContext } from '../middleware/requestLogger'
import {
  changeAccountPassword,
  loadCurrentAccount,
  loginAccount,
  registerPersonalAccount,
  revokeOtherAccountSessions,
  resolveWorkspaceSwitch,
  updateAccountProfile,
  uploadAccountAvatar,
  type WorkspaceMode,
} from '../modules/auth/auth-account.service'
import {
  avatarUpload,
  cleanupAvatarTemporaryFile,
} from '../modules/auth/auth-avatar-upload'
import { sendContractData, sendContractError } from '../lib/api-contract'

export const authRouter = Router()

function clientIp(req: Request) {
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

function workspaceMode(value: unknown): WorkspaceMode | null {
  if (value === undefined || value === null || value === '' || value === 'campus' || value === 'work') return 'work'
  return value === 'personal' ? 'personal' : null
}

function renewablePayload(payload: SessionJwtPayload): SessionJwtPayload {
  const accountRole = accountRoleFromLegacy(payload.accountRole || payload.role)
  return {
    userId: payload.userId,
    sessionVersion: payload.sessionVersion,
    accountRole,
    role: accountRole,
    username: payload.username,
    workspaceMode: payload.workspaceMode === 'personal' ? 'personal' : 'work',
  }
}

function issueToken(res: Response, payload: SessionJwtPayload) {
  const claims = renewablePayload(payload)
  const token = jwt.sign(claims, getJwtSecret(), { expiresIn: '7d' })
  setSessionCookie(res, token)
  return token
}

authRouter.post('/login', loginIpLimiter, loginAccountLimiter, async (req, res) => {
  try {
    const rawInput = req.body && typeof req.body === 'object' ? req.body : {}
    if (typeof rawInput.username !== 'string' || !rawInput.username.trim()
      || typeof rawInput.password !== 'string' || !rawInput.password) {
      return res.status(400).json({ success: false, message: '请输入用户名和密码' })
    }
    const input = LoginRequestSchema.safeParse(rawInput)
    if (!input.success) {
      return res.status(400).json({ success: false, message: '用户名或密码格式无效' })
    }
    const { username, password } = input.data
    const requestedMode = workspaceMode(input.data.workspaceMode ?? input.data.mode)
    if (!requestedMode) return res.status(400).json({ success: false, message: '无效的工作区模式' })
    const result = await loginAccount({
      username, password, workspaceMode: requestedMode,
      ipAddress: clientIp(req), userAgent: req.headers['user-agent'] || 'unknown',
    })
    if (!result.ok) {
      logger.security('login_failed', { action: 'login', target: username, metadata: { ip: clientIp(req) } })
      return res.status(401).json({ success: false, message: result.message })
    }
    issueToken(res, {
      userId: result.user.id,
      sessionVersion: result.user.sessionVersion,
      accountRole: accountRoleFromLegacy(result.role),
      role: result.role,
      username: result.user.username,
      workspaceMode: result.workspaceMode,
    })
    updateRequestContext(req, result.user.id, result.user.role)
    logger.audit('login_success', {
      userId: result.user.id, action: 'login', target: username,
      metadata: { userRole: result.user.role, loginMode: 'unified', ip: clientIp(req) },
    })
    const responseData = LoginResponseDataSchema.parse({
      userId: result.user.id,
      accountRole: accountRoleFromLegacy(result.user.role as UserRole),
      role: result.role,
      username: result.user.username,
      workspaceMode: result.workspaceMode,
      avatar: result.user.avatar,
      next: result.isGlobalAdmin ? (result.role === 'super_admin' ? '/admin' : '/platform-admin') : '/identity',
    })
    sendContractData(res, AuthContracts.login, responseData)
  } catch (error) {
    if (sendContractError(error, res)) return
    logger.error('login_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

authRouter.post('/register', registerLimiter, async (req, res) => {
  try {
    if (req.body?.role && req.body.role !== 'student') {
      return res.status(400).json({ success: false, message: '仅支持注册学生账号' })
    }
    const input = RegisterRequestSchema.safeParse(req.body || {})
    if (!input.success) return res.status(400).json({ success: false, message: '注册信息格式无效' })
    const { username, password, role } = input.data
    const usernameCheck = validateUsername(username)
    if (!usernameCheck.valid) return res.status(400).json({ success: false, message: usernameCheck.message })
    const passwordCheck = validatePassword(password)
    if (!passwordCheck.valid) return res.status(400).json({ success: false, message: passwordCheck.message })
    const user = await registerPersonalAccount(username, password)
    if (!user) return res.status(400).json({ success: false, message: '用户名已存在' })
    issueToken(res, {
      userId: user.id, sessionVersion: user.sessionVersion, accountRole: 'user', role: 'user' as UserRole, username: user.username, workspaceMode: 'personal',
    })
    sendContractData(res, AuthContracts.register, LoginResponseDataSchema.parse({
      userId: user.id, accountRole: 'user', role: 'user', username: user.username,
      workspaceMode: 'personal', next: '/personal', avatar: user.avatar,
    }))
  } catch (error) {
    if (sendContractError(error, res)) return
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
    sendContractData(res, AuthContracts.me, {
        userId: user.id,
        username: user.username,
        accountRole: accountRoleFromLegacy(user.role as UserRole),
        role: result.isGlobalAdmin ? accountRoleFromLegacy(user.role as UserRole) : (result.organizationRole || accountRoleFromLegacy(user.role as UserRole)),
        avatar: user.avatar,
        phone: user.phone,
        email: user.email,
        bio: user.bio,
        organizationId: result.organizationId || undefined,
        organizationMembershipId: membership?.id,
        organizationRole: result.organizationRole || undefined,
        schoolId: result.schoolId,
        workspaceMode: result.isGlobalAdmin ? 'work' : (payload.workspaceMode === 'personal' ? 'personal' : 'work'),
        profile: result.profile,
    })
  } catch (error) {
    if (sendContractError(error, res)) return
    logger.error('load_current_account_error', error, { userId: (req as any).user?.userId, action: 'auth_me' })
    res.status(503).json({ success: false, code: 'AUTH_SERVICE_UNAVAILABLE', message: '账号服务暂时不可用，请稍后重试' })
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
    issueToken(res, { ...renewablePayload(payload), role: role as UserRole, workspaceMode: mode })
    res.json({ success: true, data: { workspaceMode: mode, role } })
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
  sendContractData(res, AuthContracts.logout, {})
})

authRouter.put('/profile', authenticate, async (req, res) => {
  try {
    const input = ProfileUpdateSchema.safeParse(req.body || {})
    if (!input.success) return res.status(400).json({ success: false, message: '账号资料格式无效' })
    const { avatar, phone, email, bio } = input.data
    if (phone) {
      const check = validatePhone(phone)
      if (!check.valid) return res.status(400).json({ success: false, message: check.message })
    }
    if (email) {
      const check = validateEmail(email)
      if (!check.valid) return res.status(400).json({ success: false, message: check.message })
    }
    const user = await updateAccountProfile((req as any).user, { avatar, phone, email, bio })
    sendContractData(res, AuthContracts.updateProfile, {
        userId: user.id, username: user.username, role: user.role, avatar: user.avatar,
        phone: user.phone, email: user.email, bio: user.bio,
    })
  } catch (error) {
    if (sendContractError(error, res)) return
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

authRouter.put('/password', authenticate, passwordLimiter, async (req, res) => {
  try {
    const input = PasswordChangeSchema.safeParse(req.body || {})
    if (!input.success) return res.status(400).json({ success: false, message: '请填写完整信息' })
    const { currentPassword, newPassword } = input.data
    const check = validatePassword(newPassword)
    if (!check.valid) return res.status(400).json({ success: false, message: check.message })
    const result = await changeAccountPassword((req as any).user.userId, currentPassword, newPassword)
    if (!result.ok) return res.status(result.statusCode).json({ success: false, message: result.message })
    const payload = (req as any).user as JwtPayload
    issueToken(res, { ...renewablePayload(payload), sessionVersion: result.sessionVersion })
    sendContractData(res, AuthContracts.changePassword, {})
  } catch (error) {
    if (sendContractError(error, res)) return
    logger.error('change_password_error', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

authRouter.post('/sessions/revoke', authenticate, passwordLimiter, async (req, res) => {
  try {
    const payload = (req as any).user as JwtPayload
    const sessionVersion = await revokeOtherAccountSessions(payload.userId)
    issueToken(res, { ...renewablePayload(payload), sessionVersion })
    sendContractData(res, AuthContracts.revokeSessions, {})
  } catch (error) {
    if (sendContractError(error, res)) return
    logger.error('revoke_sessions_error', error, { userId: (req as any).user?.userId, action: 'session_revoke' })
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
