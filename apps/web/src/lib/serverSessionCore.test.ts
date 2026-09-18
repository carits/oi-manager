import { describe, expect, it } from 'vitest'
import { buildServerSessionHeaders, isOrganizationContextDenied } from './serverSessionCore'

describe('server session request contract', () => {
  it('adds organization context only when explicitly requested', () => {
    expect(buildServerSessionHeaders('oi_session=abc')).toEqual({ Cookie: 'oi_session=abc' })
    expect(buildServerSessionHeaders('oi_session=abc', 'school-1')).toEqual({
      Cookie: 'oi_session=abc',
      'X-OI-Organization-ID': 'school-1',
    })
  })

  it('distinguishes denied organization context from anonymous session', () => {
    expect(isOrganizationContextDenied(403, 'ORGANIZATION_ACCESS_DENIED', 'school-1')).toBe(true)
    expect(isOrganizationContextDenied(404, 'ORGANIZATION_NOT_AVAILABLE', 'school-1')).toBe(true)
    expect(isOrganizationContextDenied(403, 'ORGANIZATION_ACCESS_DENIED')).toBe(false)
    expect(isOrganizationContextDenied(401, 'ORGANIZATION_ACCESS_DENIED', 'school-1')).toBe(false)
  })
})

