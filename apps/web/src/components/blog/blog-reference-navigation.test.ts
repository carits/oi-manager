import { describe, expect, it } from 'vitest'
import { referenceHref, type PublishedBlogReference } from './blog-reference-navigation'

const reference = (patch: Partial<PublishedBlogReference>): PublishedBlogReference => ({
  id: 'reference-1',
  type: 'PROBLEM',
  referenceId: 'problem-internal-id',
  accessMode: 'PUBLIC',
  status: 'CURRENT',
  snapshot: {},
  ...patch,
})

describe('published blog reference navigation', () => {
  it('links platform and organization problems to their readable workspace', () => {
    expect(referenceHref(reference({ type: 'PROBLEM' }))).toBe('/personal/problems/problem-internal-id')
    expect(referenceHref(reference({ type: 'PROBLEM_REVISION', snapshot: { organizationId: 'school-1' } }))).toBe('/org/school-1/problems/problem-internal-id')
  })

  it('links immutable solutions and standing snapshots to the relevant tab', () => {
    expect(referenceHref(reference({ type: 'SOLUTION_VERSION', snapshot: { problem: { id: 'problem-2', organizationId: 'school-1' } } }))).toBe('/org/school-1/problems/problem-2?tab=solution')
    expect(referenceHref(reference({ type: 'CONTEST_STANDING', referenceId: '41', snapshot: { trainingId: 41 } }))).toBe('/personal/contests/41?tab=ranking')
    expect(referenceHref(reference({ type: 'RATING_CHANGE', snapshot: { organizationId: 'school-1', contest: { id: 42 } } }))).toBe('/org/school-1/contests/42?tab=ranking')
  })

  it('does not turn an immutable submission snapshot into a private submission link', () => {
    expect(referenceHref(reference({ type: 'SUBMISSION_SNAPSHOT', referenceId: 'snapshot-1' }))).toBeNull()
  })
})
