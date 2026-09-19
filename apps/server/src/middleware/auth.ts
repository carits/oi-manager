import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { JwtPayload, ResourceScope } from '@oi-manager/shared'
import { AccountRoleSchema, type AccountRole } from '@oi-manager/contracts'
import { getJwtSecret } from '../lib/jwtSecret'
import { getSessionToken } from '../lib/sessionCookie'
import { prisma } from '../prisma'
import logger from '../lib/logger'
import { organizationRoleFromRoleKeys, resolveOrganizationAuthorization } from '../modules/authorization/capabilities'

// 全局类型扩展：让 Express Request.user 使用 JwtPayload 类型
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

export interface AuthRequest extends Request {
  user?: JwtPayload
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const token = getSessionToken(req)

  if (!token) {
    return res.status(401).json({ success: false, message: '未授权，请先登录' })
  }

  let decoded: JwtPayload
  try {
    decoded = jwt.verify(token, getJwtSecret()) as JwtPayload
  } catch {
    return res.status(401).json({ success: false, code: 'AUTH_INVALID_SESSION', message: '登录状态无效或已过期' })
  }
  if (!decoded?.userId) {
    return res.status(401).json({ success: false, code: 'AUTH_INVALID_SESSION', message: '登录状态无效或已过期' })
  }

  try {
    const signedAccountRole = AccountRoleSchema.safeParse(decoded.accountRole)
    if (!signedAccountRole.success) {
      return res.status(401).json({ success: false, code: 'INVALID_SESSION', message: '登录状态无效，请重新登录' })
    }
    decoded.workspaceMode = decoded.workspaceMode === 'personal' ? 'personal' : 'work'

    // Account identity always comes from the current database record.
    const account = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true, status: true, sessionVersion: true }
    })
    if (!account || account.status === 'disabled') {
      return res.status(401).json({ success: false, code: 'ACCOUNT_DISABLED', message: '账号不存在或已被禁用' })
    }
    if ((decoded.sessionVersion ?? 1) !== account.sessionVersion) {
      return res.status(401).json({ success: false, code: 'SESSION_REVOKED', message: '登录状态已失效，请重新登录' })
    }
    decoded.sessionVersion = account.sessionVersion
    const parsedAccountRole = AccountRoleSchema.safeParse(account.role)
    if (!parsedAccountRole.success) {
      return res.status(403).json({ success: false, code: 'ACCOUNT_ROLE_INVALID', message: '账号权限配置无效' })
    }
    const accountRole = parsedAccountRole.data
    decoded.accountRole = accountRole
    delete decoded.organizationId
    delete decoded.organizationMembershipId
    delete decoded.organizationRole
    delete decoded.organizationCapabilities
    if (accountRole === 'super_admin' || accountRole === 'platform_admin') {
      decoded.workspaceMode = 'work'
    }

    const organizationId = req.get('x-oi-organization-id')
    if (organizationId) {
      const authorization = await resolveOrganizationAuthorization(decoded.userId, organizationId)
      if (!authorization) {
        return res.status(403).json({ success: false, code: 'ORGANIZATION_ACCESS_DENIED', message: '无权访问该组织' })
      }
      const organizationRole = organizationRoleFromRoleKeys(authorization.roleKeys)
      if (!organizationRole) return res.status(403).json({ success: false, code: 'ORGANIZATION_AUTHORIZATION_INCOMPLETE', message: '组织权限尚未完成配置' })
      decoded.organizationId = organizationId
      decoded.organizationMembershipId = authorization.membershipId
      decoded.organizationRole = organizationRole
      decoded.organizationCapabilities = [...authorization.capabilities].sort()
    }
    req.user = decoded
    next()
  } catch (error) {
    logger.error('authentication_service_error', error, {
      requestId: req.requestId,
      userId: decoded.userId,
      action: 'authenticate',
      metadata: { path: req.path, method: req.method },
    })
    return res.status(503).json({ success: false, code: 'AUTH_SERVICE_UNAVAILABLE', message: '认证服务暂时不可用，请稍后重试' })
  }
}

/** Public reads may attach an account identity when one is present, while a
 * genuinely anonymous request remains valid. Invalid supplied credentials are
 * still rejected instead of being silently downgraded to anonymous access. */
export async function optionalAuthenticate(req: AuthRequest, res: Response, next: NextFunction) {
  if (!getSessionToken(req)) return next()
  return authenticate(req, res, next)
}

export function getActiveOrganizationId(user?: JwtPayload): string | undefined {
  return user?.organizationId
}

export function getAccountRole(user?: Pick<JwtPayload, 'accountRole'>): AccountRole | undefined {
  return user?.accountRole
}

/** Global account authorization. Organization permissions must use capabilities. */
export function authorize(...roles: AccountRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未授权' })
    }

    if (!roles.includes(getAccountRole(req.user)!)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    next()
  }
}

// 检查是否为管理员（super_admin 或 platform_admin）
export function isAdmin(accountRole: AccountRole): boolean {
  return accountRole === 'super_admin' || accountRole === 'platform_admin'
}

// 检查是否为超级管理员
export function isSuperAdmin(accountRole: AccountRole): boolean {
  return accountRole === 'super_admin'
}

export function isPersonalContext(user?: JwtPayload): boolean {
  return !user?.organizationId
}

export function getResourceScope(user?: JwtPayload): ResourceScope {
  return isPersonalContext(user) ? 'personal' : 'campus'
}

export function getMembershipType(user: JwtPayload): 'teacher' | 'student' | 'user' {
  return isPersonalContext(user) ? 'user' : user.organizationRole === 'student' ? 'student' : 'teacher'
}

export function requireOrganizationContext(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, message: '未授权' })
  if (!req.user.organizationId) return res.status(403).json({ success: false, code: 'ORGANIZATION_REQUIRED', message: '请从校园身份进入' })
  next()
}

export function requirePersonalContext(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ success: false, message: '未授权' })
  if (req.user.organizationId) return res.status(403).json({ success: false, code: 'PERSONAL_CONTEXT_REQUIRED', message: '请从个人身份进入' })
  next()
}

export function isPersonalContextForTeams(user?: JwtPayload): boolean {
  return isPersonalContext(user)
}
