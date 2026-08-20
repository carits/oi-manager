import { describe, expect, it } from 'vitest'
import { canModifyProblem, canViewProblem } from '../src/modules/problem/problem.access'

const platformDraft = {
  id: 'platform-problem',
  libraryScope: 'platform',
  organizationId: null,
  ownerId: 'owner',
  status: 'draft',
  visibility: 'public',
} as const

describe('platform problem access', () => {
  it('allows platform managers to manage platform drafts without an organization context', () => {
    const platformAdmin = { userId: 'admin', role: 'platform_admin', username: 'platform-admin', workspaceMode: 'work' } as any
    const superAdmin = { userId: 'super', role: 'super_admin', username: 'super-admin', workspaceMode: 'work' } as any
    expect(canViewProblem(platformAdmin, platformDraft)).toBe(true)
    expect(canModifyProblem(platformAdmin, platformDraft)).toBe(true)
    expect(canViewProblem(superAdmin, platformDraft)).toBe(true)
    expect(canModifyProblem(superAdmin, platformDraft)).toBe(true)
  })

  it('does not grant school problem access to a platform manager without organization scope', () => {
    const platformAdmin = { userId: 'admin', role: 'platform_admin', username: 'platform-admin', workspaceMode: 'work' } as any
    const schoolDraft = { ...platformDraft, libraryScope: 'school', organizationId: 'school-org' }
    expect(canViewProblem(platformAdmin, schoolDraft)).toBe(false)
    expect(canModifyProblem(platformAdmin, schoolDraft)).toBe(false)
  })
})
