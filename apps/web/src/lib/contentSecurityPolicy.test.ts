import { describe, expect, it } from 'vitest'
import {
  buildContentSecurityPolicy,
  contentSecurityPolicyHeader,
  parseContentSecurityPolicyMode,
} from './contentSecurityPolicy'

describe('content security policy', () => {
  it('fails closed to off unless an explicit rollout mode is selected', () => {
    expect(parseContentSecurityPolicyMode()).toBe('off')
    expect(parseContentSecurityPolicyMode('invalid')).toBe('off')
    expect(parseContentSecurityPolicyMode('report-only')).toBe('report-only')
    expect(parseContentSecurityPolicyMode('enforce')).toBe('enforce')
  })

  it('uses the matching report-only or enforcing header', () => {
    expect(contentSecurityPolicyHeader('off')).toBeNull()
    expect(contentSecurityPolicyHeader('report-only')).toBe('Content-Security-Policy-Report-Only')
    expect(contentSecurityPolicyHeader('enforce')).toBe('Content-Security-Policy')
  })

  it('builds a nonce-based script policy without unsafe script fallbacks', () => {
    const policy = buildContentSecurityPolicy('validNonce_123=')
    expect(policy).toContain("script-src 'self' 'nonce-validNonce_123=' 'strict-dynamic'")
    expect(policy).not.toContain("script-src 'unsafe-inline'")
    expect(policy).not.toContain("script-src 'unsafe-eval'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
  })

  it('rejects a nonce that could inject another directive', () => {
    expect(() => buildContentSecurityPolicy("nonce'; default-src *")).toThrow(
      'CSP nonce contains invalid characters',
    )
  })
})
