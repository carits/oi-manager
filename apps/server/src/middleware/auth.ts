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

    // 角色以数据库中的全局账号为准，兼容管理员在旧版本生成的 teacher/student token。
    // 组织成员关系只用于普通账号切换校园身份，不能覆盖全局管理员权限。
    const account = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { role: true, status: true }
    })
    if (!account || account.status === 'disabled') {
      return res.status(401).json({ success: false, message: '账号不存在或已被禁用' })
    }
    if (account.role === 'super_admin' || account.role === 'platform_admin') {
      decoded.role = account.role as UserRole
      decoded.workspaceMode = 'work'
    }

    let organizationId = req.get('x-oi-organization-id')
    // Compatibility for campus JWTs issued before organizationId became the
    // request context key. schoolId is a School.id, so it must be resolved via
    // School.organizationId and still pass the active-membership check below.
    if (
      !organizationId
      && decoded.workspaceMode === 'work'
      && decoded.schoolId
      && decoded.role !== 'super_admin'
      && decoded.role !== 'platform_admin'
    ) {
      const legacySchool = await prisma.school.findUnique({
        where: { id: decoded.schoolId },
        select: { organizationId: true, status: true, directoryStatus: true },
      })
      if (legacySchool?.status === 'active' && legacySchool.directoryStatus !== 'legacy' && legacySchool.organizationId) {
        organizationId = legacySchool.organizationId
      }
    }
    if (organizationId) {
      const membership = await prisma.organizationMembership.findFirst({
        where: { organizationId, userId: decoded.userId, status: 'active', Organization: { status: 'active' } },
        select: {
          id: true,
          memberRole: true,
          Organization: { select: { type: true, School: { select: { directoryStatus: true } } } },
        }
      })
      if (!membership) return res.status(403).json({ success: false, code: 'ORGANIZATION_ACCESS_DENIED', message: '无权访问该组织' })
      if (membership.Organization.type === 'school' && membership.Organization.School?.directoryStatus === 'legacy') {
        return res.status(404).json({ success: false, code: 'ORGANIZATION_NOT_AVAILABLE', message: '该组织不可用' })
      }
      decoded.organizationId = organizationId
      decoded.organizationMembershipId = membership.id
      // 平台管理员/超级管理员是全局身份，进入学校上下文时仍须保留管理员权限。
      // 普通账号才根据当前校园成员关系切换为老师/学生身份。
      if (decoded.role !== 'super_admin' && decoded.role !== 'platform_admin') {
        decoded.role = membership.memberRole as UserRole
      }
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
