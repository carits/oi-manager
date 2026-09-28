import { describe, expect, it } from 'vitest'
import { problemReferenceHref } from './model/problemReferencePath'

describe('problem reference workspace routes', () => {
  it.each([
    ['/personal/training-sessions', '/personal'],
    ['/org/school-a/training-sessions/session/design', '/org/school-a'],
    ['/org/school-b/problem-lists/list', '/org/school-b'],
    ['/platform-admin/contests', '/platform-admin'],
    ['/admin/contests', '/platform-admin'],
  ])('keeps %s within its supported problem workspace', (pathname, prefix) => {
    expect(problemReferenceHref(pathname, 'canonical-id')).toBe(`${prefix}/problems/canonical-id?returnTo=${encodeURIComponent(pathname)}`)
  })
  it('encodes the internal identifier as exactly one path segment', () => {
    expect(problemReferenceHref('/personal/contests', 'id/with?reserved')).toBe('/personal/problems/id%2Fwith%3Freserved?returnTo=%2Fpersonal%2Fcontests')
  })
})
