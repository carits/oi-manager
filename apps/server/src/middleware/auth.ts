import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { JwtPayload, UserRole } from '@oi-manager/shared'
import { getJwtSecret } from '../lib/jwtSecret'

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

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '未授权，请先登录' })
  }

  const token = authHeader.substring(7)

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as JwtPayload
    req.user = decoded
    next()
  } catch {
    return res.status(401).json({ success: false, message: 'Token 无效或已过期' })
  }
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
