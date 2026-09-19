import jwt from 'jsonwebtoken'
import type { JwtPayload } from '../../../../packages/shared/src'
import type { AccountRole } from '../../../../packages/contracts/src'

const JWT_SECRET = 'test-secret-key-for-testing-only'

export function generateTestToken(payload: {
  userId: string
  sessionVersion?: number
  accountRole: AccountRole
  username: string
  workspaceMode?: 'work' | 'personal'
}): string {
  return jwt.sign({
    userId: payload.userId,
    sessionVersion: payload.sessionVersion,
    accountRole: payload.accountRole,
    username: payload.username,
    workspaceMode: payload.workspaceMode || 'work',
  }, JWT_SECRET, { expiresIn: '1h' })
}

export function generateTokenFromUser(user: {
  id: string
  sessionVersion?: number
  accountRole: AccountRole
  username: string
  workspaceMode?: 'work' | 'personal'
}): string {
  return generateTestToken({
    userId: user.id,
    sessionVersion: user.sessionVersion,
    accountRole: user.accountRole,
    username: user.username,
    workspaceMode: user.workspaceMode,
  })
}

export function verifyTestToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch {
    return null
  }
}
