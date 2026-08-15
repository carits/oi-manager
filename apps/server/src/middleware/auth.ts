import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { JwtPayload, UserRole, WorkspaceMode, ResourceScope } from '@oi-manager/shared'
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
    decoded.workspaceMode = getWorkspaceMode(decoded)
    const organizationId = req.get('x-oi-organization-id')
    if (organizationId && decoded.workspaceMode === 'work') {
      const membership = await prisma.organizationMembership.findFirst({
        where: { organizationId, userId: decoded.userId, status: 'active', Organization: { status: 'active' } },
        select: {
          id: true,
          memberRole: true,
          Organization: { select: { School: { select: { id: true } } } }
        }
      })
      const schoolId = membership?.Organization.School?.id
      if (!schoolId) return res.status(403).json({ success: false, code: 'ORGANIZATION_ACCESS_DENIED', message: '无权访问该工作区' })
      decoded.organizationId = organizationId
      decoded.schoolId = schoolId
      decoded.organizationMembershipId = membership.id
      // 校园权限只取当前成员关系：同一账号在不同校园可拥有不同身份。
      decoded.role = membership.memberRole as UserRole
    }
    if (decoded.role === 'student' && !decoded.studentMode) {
      decoded.studentMode = decoded.workspaceMode === 'personal' ? 'personal' : 'campus'
    }
    req.user = decoded
    req.authSource = bearerToken ? 'bearer' : 'cookie'
    next()
  } catch {
    return res.status(401).json({ success: false, message: 'Token 无效或已过期' })
  }
}

export function getActiveOrganizationId(user?: JwtPayload): string | undefined {
  return getWorkspaceMode(user) === 'work' ? user?.organizationId : undefined
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

export function getWorkspaceMode(user?: JwtPayload): WorkspaceMode {
  if (user?.workspaceMode === 'personal') return 'personal'
  if (user?.studentMode === 'personal') return 'personal'
  return 'work'
}

export function getResourceScope(user?: JwtPayload): ResourceScope {
  return getWorkspaceMode(user) === 'personal' ? 'personal' : 'campus'
}

export function getMembershipType(user: JwtPayload): 'teacher' | 'student' | 'user' {
  return getWorkspaceMode(user) === 'personal' ? 'user' : getUserType(user.role)
}

export function requireWorkspace(mode: WorkspaceMode) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未授权' })
    }
    if (getWorkspaceMode(req.user) !== mode) {
      return res.status(403).json({
        success: false,
        code: 'WORKSPACE_MODE_REQUIRED',
        message: mode === 'personal' ? '请先切换到个人模式' : '请先切换到工作模式'
      })
    }
    next()
  }
}

export function isPersonalWorkspace(user?: JwtPayload): boolean {
  return getWorkspaceMode(user) === 'personal'
}

/**
 * 检查用户是否为个人模式学生
 * 个人模式学生拥有更多权限（创建团队、题单等）
 */
export function isPersonalMode(user?: JwtPayload): boolean {
  return isPersonalWorkspace(user)
}
