import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { JwtPayload, UserRole, ResourceScope } from '@oi-manager/shared'
import { getJwtSecret } from '../lib/jwtSecret'
import { getSessionToken } from '../lib/sessionCookie'
import { prisma } from '../prisma'

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

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload
    decoded.workspaceMode = decoded.workspaceMode === 'personal' ? 'personal' : 'work'
    const organizationId = req.get('x-oi-organization-id')
    if (organizationId) {
      const membership = await prisma.organizationMembership.findFirst({
        where: { organizationId, userId: decoded.userId, status: 'active', Organization: { status: 'active' } },
        select: {
          id: true,
          memberRole: true,
        }
      })
      if (!membership) return res.status(403).json({ success: false, code: 'ORGANIZATION_ACCESS_DENIED', message: '无权访问该组织' })
      decoded.organizationId = organizationId
      decoded.organizationMembershipId = membership.id
      // 校园权限只取当前成员关系：同一账号在不同校园可拥有不同身份。
      decoded.role = membership.memberRole as UserRole
    }
    req.user = decoded
    req.authSource = bearerToken ? 'bearer' : 'cookie'
    next()
  } catch {
    return res.status(401).json({ success: false, message: 'Token 无效或已过期' })
  }
}

export function getActiveOrganizationId(user?: JwtPayload): string | undefined {
  return user?.organizationId
}

export function authorize(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未授权' })
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    next()
  }
}

// 检查是否为管理员（super_admin 或 platform_admin）
export function isAdmin(role: UserRole): boolean {
  return role === 'super_admin' || role === 'platform_admin'
}

// 检查是否为超级管理员
export function isSuperAdmin(role: UserRole): boolean {
  return role === 'super_admin'
}

// 权限检查中间件 - 允许多个角色中的任意一个
export function authorizeAny(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未授权' })
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }
    next()
  }
}

/**
 * 从用户角色推导用户类型
 * student → 'student'
 * teacher/school_principal/super_admin/platform_admin → 'teacher'
 */
export function getUserType(role: string): 'teacher' | 'student' {
  return role === 'student' ? 'student' : 'teacher'
}

export function isPersonalContext(user?: JwtPayload): boolean {
  return !user?.organizationId
}

export function getResourceScope(user?: JwtPayload): ResourceScope {
  return isPersonalContext(user) ? 'personal' : 'campus'
}

export function getMembershipType(user: JwtPayload): 'teacher' | 'student' | 'user' {
  return isPersonalContext(user) ? 'user' : getUserType(user.role)
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
