import { expect, type APIRequestContext } from '@playwright/test'
import { accounts, type AuthRole } from './auth'

export interface AuthSession {
  token: string
  userId: string
  role: string
  schoolId?: string
  studentMode?: string
  workspaceMode?: 'work' | 'personal'
}

export async function loginAs(
  request: APIRequestContext,
  role: AuthRole,
): Promise<AuthSession> {
  const account = accounts[role]
  const response = await request.post('/api/auth/login', {
    data: {
      username: account.username,
      password: account.password,
      role: account.loginRole,
      workspaceMode: account.workspaceMode,
    },
  })

  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.success).toBe(true)
  return body.data as AuthSession
}

export function bearer(session: AuthSession) {
  return { Authorization: `Bearer ${session.token}` }
}

export function responseItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  const payload = data as Record<string, unknown>
  for (const key of ['items', 'data', 'lists']) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[]
  }
  return []
}
