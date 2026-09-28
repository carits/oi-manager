import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getSidebarNavigationPreference,
  parseSidebarNavigationPreference,
  setSidebarNavigationOpen,
  sidebarNavigationCookie,
  sidebarNavigationCookieName,
} from './auth'

afterEach(() => vi.unstubAllGlobals())

describe('non-sensitive sidebar preferences', () => {
  it.each(['open', 'closed'] as const)('accepts %s', value => {
    expect(parseSidebarNavigationPreference(value)).toBe(value)
  })
  it.each([undefined, null, '', 'true', 'expanded', 'closed; injected=true'])('rejects malformed preference %s', value => {
    expect(parseSidebarNavigationPreference(value)).toBeNull()
  })
  it('encodes cookie names and never encodes membership into display state', () => {
    expect(sidebarNavigationCookieName('a; b=c')).toBe('oi_sidebar_a%3B%20b%3Dc')
    expect(sidebarNavigationCookie('user-1', false, true)).toBe(
      'oi_sidebar_user-1=closed; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
    )
    expect(sidebarNavigationCookie('user-1', true, false)).not.toContain('; Secure')
  })
  it('uses one user/device preference across roles and workspaces', () => {
    vi.stubGlobal('document', { cookie: 'other=1; oi_sidebar_user-1=closed' })
    expect(getSidebarNavigationPreference('user-1', 'teacher', 'org-a')).toBe('closed')
    expect(getSidebarNavigationPreference('user-1', 'student', 'org-b')).toBe('closed')
    expect(getSidebarNavigationPreference('user-1', 'user', 'personal')).toBe('closed')
    expect(getSidebarNavigationPreference('user-2', 'user', 'personal')).toBeNull()
  })
  it('does not fail navigation when browser cookies are blocked', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } })
    vi.stubGlobal('document', Object.defineProperty({}, 'cookie', {
      get() { throw new Error('blocked') },
      set() { throw new Error('blocked') },
    }))
    expect(getSidebarNavigationPreference('user-1')).toBeNull()
    expect(() => setSidebarNavigationOpen('user-1', 'teacher', 'org-a', false)).not.toThrow()
  })
  it('is safe without a browser', () => {
    expect(getSidebarNavigationPreference('user-1')).toBeNull()
    expect(() => setSidebarNavigationOpen('user-1', 'teacher', 'org-a', false)).not.toThrow()
  })
})
