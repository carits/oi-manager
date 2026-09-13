import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { JwtPayload, UserRole, ResourceScope } from '@oi-manager/shared'
import { accountRoleFromLegacy, type AccountRole } from '@oi-manager/contracts'
import { getJwtSecret } from '../lib/jwtSecret'
import { getSessionToken } from '../lib/sessionCookie'
import { prisma } from '../prisma'
import logger from '../lib/logger'
import { isUnavailableLegacyOrganizationMember, organizationRoleFromRoleKeys, resolveOrganizationAuthorization } from '../modules/authorization/capabilities'

// 全局类型扩展：让 Express Request.user 使用 JwtPayload 类型
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload
      authSource?: 'cookie' | 'bearer'
    }
  }
}

export interface AuthRequest extends Request {
  user?: JwtPayload
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : null
  const cookieToken = getSessionToken(req)
  const token = bearerToken || cookieToken

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
    decoded.workspaceMode = decoded.workspaceMode === 'personal' ? 'personal' : 'work'

    // 角色以数据库中的全局账号为准，兼容管理员在旧版本生成的 teacher/student token。
    // 组织成员关系只用于普通账号切换校园身份，不能覆盖全局管理员权限。
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
    const accountRole = accountRoleFromLegacy(account.role as UserRole)
    decoded.accountRole = accountRole
    decoded.role = accountRole as UserRole
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
        if (await isUnavailableLegacyOrganizationMember(decoded.userId, organizationId)) {
          return res.status(404).json({ success: false, code: 'ORGANIZATION_NOT_AVAILABLE', message: '组织不可用' })
        }
        return res.status(403).json({ success: false, code: 'ORGANIZATION_ACCESS_DENIED', message: '无权访问该组织' })
      }
      const organizationRole = organizationRoleFromRoleKeys(authorization.roleKeys)
      if (!organizationRole) return res.status(403).json({ success: false, code: 'ORGANIZATION_AUTHORIZATION_INCOMPLETE', message: '组织权限尚未完成配置' })
      decoded.organizationId = organizationId
      decoded.organizationMembershipId = authorization.membershipId
      decoded.organizationRole = organizationRole
      decoded.organizationCapabilities = [...authorization.capabilities].sort()
      // 平台管理员/超级管理员是全局身份，进入学校上下文时仍须保留管理员权限。
      // 普通账号才根据当前校园成员关系切换为老师/学生身份。
      if (accountRole !== 'super_admin' && accountRole !== 'platform_admin') {
        decoded.role = organizationRole as UserRole
      }
    }
    req.user = decoded
    req.authSource = bearerToken ? 'bearer' : 'cookie'
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
  const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '))
  const hasCookie = Boolean(getSessionToken(req))
  if (!hasBearer && !hasCookie) return next()
  return authenticate(req, res, next)
}

export function getActiveOrganizationId(user?: JwtPayload): string | undefined {
  return user?.organizationId
}

export function getAccountRole(user?: Pick<JwtPayload, 'accountRole' | 'role'>): AccountRole | undefined {
  if (!user) return undefined
  return user.accountRole || accountRoleFromLegacy(user.role)
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
export function isAdmin(role: UserRole | AccountRole): boolean {
  const accountRole = accountRoleFromLegacy(role)
  return accountRole === 'super_admin' || accountRole === 'platform_admin'
}

// 检查是否为超级管理员
export function isSuperAdmin(role: UserRole | AccountRole): boolean {
  return accountRoleFromLegacy(role) === 'super_admin'
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
