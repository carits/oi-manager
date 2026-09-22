import { expect, test } from '@playwright/test'
import { sessionCookie, loginAs } from '../fixtures/api'

test.describe('sensitive API permission matrix', () => {
  const configPath = '/api/oj-fetcher/platforms/luogu/config'

  test('OJ credentials are super-admin only and never expose the raw cookie', async ({ request }) => {
    const anonymous = await request.get(configPath)
    expect(anonymous.status()).toBe(401)

    for (const role of ['teacher', 'principal', 'platformAdmin'] as const) {
      const session = await loginAs(request, role)
      const response = await request.get(configPath, { headers: sessionCookie(session) })
      expect(response.status(), role).toBe(403)
    }

    const superAdmin = await loginAs(request, 'superAdmin')
    const response = await request.get(configPath, { headers: sessionCookie(superAdmin) })
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/cookie\s*[:=]\s*["'][^"']+/i)
  })
})
