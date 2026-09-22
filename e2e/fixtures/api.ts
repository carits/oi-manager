import { expect, type APIRequestContext } from '@playwright/test'
import { accounts, type AuthRole } from './auth'

export interface AuthSession {
  cookie: string
  userId: string
  accountRole: 'user' | 'platform_admin' | 'super_admin'
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
      workspaceMode: account.workspaceMode,
    },
  })

  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.success).toBe(true)
  const cookie = response.headers()['set-cookie']?.split(';', 1)[0]
  expect(cookie).toBeTruthy()
  return { ...body.data, cookie } as AuthSession
}

export function sessionCookie(session: AuthSession) {
  return { Cookie: session.cookie }
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
