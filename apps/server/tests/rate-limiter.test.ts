import type { Request } from 'express'
import { describe, expect, it } from 'vitest'
import { getRateLimitKey, normalizeLoginAccount } from '../src/middleware/rateLimiter'
import { generateTestToken } from './helpers/testToken'

function fakeRequest(headers: Request['headers'] = {}, ip = '203.0.113.10'): Request {
  return {
    headers,
    ip,
    socket: { remoteAddress: ip }
  } as Request
}

describe('global rate-limit identity', () => {
  const token = generateTestToken({
    userId: 'rate-limit-user',
    role: 'student',
    username: 'rate_limit_student'
  })

  it('uses a verified bearer user instead of the shared campus IP', () => {
    expect(getRateLimitKey(fakeRequest({ authorization: `Bearer ${token}` })))
      .toBe('user:rate-limit-user')
  })

  it('uses a verified session-cookie user instead of the shared campus IP', () => {
    expect(getRateLimitKey(fakeRequest({ cookie: `other=value; oi_session=${token}` })))
      .toBe('user:rate-limit-user')
  })

  it('keeps invalid credentials in the anonymous IP bucket', () => {
    const key = getRateLimitKey(fakeRequest({ authorization: 'Bearer forged-token' }))
    expect(key).toMatch(/^ip:/)
    expect(key).not.toContain('forged-token')
  })
})

describe('login failed-attempt identity', () => {
  it('normalizes case, spacing and full-width account text', () => {
    expect(normalizeLoginAccount('  Teacher1  ')).toBe('teacher1')
    expect(normalizeLoginAccount('Ｔｅａｃｈｅｒ１')).toBe('teacher1')
  })
})
