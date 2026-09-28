import { describe, expect, it } from 'vitest'
import { accountContextMatches, isApplicationPath, organizationFromPath, organizationUnavailableAffectsPath, pageLayoutForPath } from './applicationShell'

describe('persistent application shell route contract', () => {
  it.each(['/personal', '/personal/teams', '/org/school-a/overview', '/account/profile', '/admin', '/platform-admin/problems'])('owns %s', path => { expect(isApplicationPath(path)).toBe(true) })
  it.each(['/login', '/identity', '/blog/a', '/', '/administrator', '/personalized'])('does not wrap public or recovery route %s', path => { expect(isApplicationPath(path)).toBe(false) })
  it('does not accept another organization role or school data in personal space', () => {
    const teacher = { organizationId: 'a', organizationRole: 'teacher' }
    expect(accountContextMatches('/org/a/teams', teacher)).toBe(true)
    expect(accountContextMatches('/org/b/teams', teacher)).toBe(false)
    expect(accountContextMatches('/personal/teams', teacher)).toBe(false)
    expect(accountContextMatches('/personal', {})).toBe(true)
    expect(accountContextMatches('/org/a/teams', { organizationId: 'a' })).toBe(false)
  })
  it('parses only complete organization route segments', () => {
    expect(organizationFromPath('/org/a/overview')).toBe('a')
    expect(organizationFromPath('/organization/a')).toBeUndefined()
    expect(organizationFromPath('/org/%E0%A4%A/overview')).toBeUndefined()
  })
  it('ignores stale organization-unavailable events from another workspace', () => {
    expect(organizationUnavailableAffectsPath('/org/b/overview', 'a')).toBe(false)
    expect(organizationUnavailableAffectsPath('/org/b/overview', 'b')).toBe(true)
    expect(organizationUnavailableAffectsPath('/org/b/overview')).toBe(true)
    expect(organizationUnavailableAffectsPath('/personal', 'b')).toBe(false)
  })
  it('resolves layout synchronously and does not mistake creation for a resource identifier', () => {
    expect(pageLayoutForPath('/org/a/training-sessions/b/design')).toBe('workbench')
    expect(pageLayoutForPath('/account/security')).toBe('form')
    expect(pageLayoutForPath('/platform-admin/problems/new')).toBe('form')
    expect(pageLayoutForPath('/personal/knowledge/b')).toBe('reading')
    expect(pageLayoutForPath('/personal/teams')).toBe('default')
  })
})
