import { describe, expect, it } from 'vitest'
import { buildTrainingListQuery, resolveTrainingListTeamId } from './trainingListScope'

describe('training list scope', () => {
  it('uses the team from a personal workspace URL as the server scope', () => {
    expect(buildTrainingListQuery({ selectedTeamId: 'team-a', statusGroup: 'active', page: 1, pageSize: 20 })).toEqual({
      teamId: 'team-a',
      statusGroup: 'active',
      page: '1',
      pageSize: '20',
    })
  })

  it('uses filterTeamId only inside an organization workspace', () => {
    expect(buildTrainingListQuery({ organizationId: 'org-a', selectedTeamId: 'team-a', statusGroup: 'completed', page: 2, pageSize: 20, keyword: '  基础训练  ' })).toEqual({
      organizationId: 'org-a',
      filterTeamId: 'team-a',
      statusGroup: 'completed',
      page: '2',
      pageSize: '20',
      keyword: '基础训练',
    })
  })

  it('does not silently replace an unauthorized personal team with an unfiltered scope', () => {
    const query = buildTrainingListQuery({ selectedTeamId: 'unknown-team', statusGroup: 'active', page: 1, pageSize: 20 })
    expect(query.teamId).toBe('unknown-team')
  })

  it('prefers a fixed embedded team over a URL team', () => {
    expect(resolveTrainingListTeamId('team-fixed', 'team-url')).toBe('team-fixed')
  })
})
