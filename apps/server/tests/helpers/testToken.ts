import jwt from 'jsonwebtoken'
import type { JwtPayload } from '../../../../packages/shared/src'
import type { AccountRole, OrganizationMembershipRole } from '../../../../packages/contracts/src'

const JWT_SECRET = 'test-secret-key-for-testing-only'

/**
 * 生成测试用 JWT Token
 */
export function generateTestToken(payload: {
  userId: string
  sessionVersion?: number
  role: AccountRole | OrganizationMembershipRole
  username: string
  teacherId?: string
  studentId?: string
  adminId?: string
  schoolId?: string
  workspaceMode?: 'work' | 'personal'
  studentMode?: 'campus' | 'personal'
}): string {
  const accountRole: AccountRole = payload.role === 'super_admin' || payload.role === 'platform_admin' ? payload.role : 'user'
  return jwt.sign({ userId: payload.userId, sessionVersion: payload.sessionVersion, accountRole, username: payload.username, workspaceMode: payload.workspaceMode || 'work' }, JWT_SECRET, { expiresIn: '1h' })
}

/**
 * 从用户数据生成 Token
 */
export function generateTokenFromUser(user: {
  id: string
  sessionVersion?: number
  role: AccountRole | OrganizationMembershipRole
  username: string
  teacherId?: string
  studentId?: string
  schoolId?: string
  workspaceMode?: 'work' | 'personal'
  studentMode?: 'campus' | 'personal'
}): string {
  const payload = {
    userId: user.id,
    sessionVersion: user.sessionVersion,
    role: user.role,
    username: user.username,
    teacherId: user.teacherId,
    studentId: user.studentId,
    schoolId: user.schoolId,
    workspaceMode: user.workspaceMode,
    studentMode: user.studentMode
  }
  return generateTestToken(payload)
}

/**
 * 验证并解码 Token
 */
export function verifyTestToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch {
    return null
  }
}
