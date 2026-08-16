import { canNavigate, fallbackHref, listHref, notificationTeamHref, resourceHref, workspaceHref } from './workspaceRouting'

describe('组织路由能力', () => {
  const organization = { workspace: 'organization' as const, organizationId: 'org_1', role: 'student' }
  it('只生成组织和个人规范路径', () => {
    expect(resourceHref('team', organization, 'team_1')).toBe('/org/org_1/teams/team_1')
    expect(resourceHref('contest', organization, 18)).toBe('/org/org_1/contests/18')
    expect(resourceHref('submission', organization, 9)).toBe('/org/org_1/submissions/9')
    expect(listHref('homework', organization)).toBe('/org/org_1/homeworks')
    expect(notificationTeamHref('organization', 'org_1', 'team:team_1')).toBe('/org/org_1/teams/team_1')
  })
  it('缺少组织上下文时拒绝生成资源地址', () => {
    expect(resourceHref('team', { workspace: 'organization', role: 'teacher' }, 'team_1')).toBeNull()
    expect(fallbackHref({ workspace: 'organization', role: 'teacher' })).toBe('/identity')
    expect(canNavigate(null)).toBe(false)
  })
  it('个人路径保持隔离', () => {
    const personal = { workspace: 'personal' as const, role: 'student' }
    expect(resourceHref('team', personal, 'team_1')).toBe('/personal/teams/team_1')
    expect(listHref('contest', personal)).toBe('/personal/contests')
    expect(notificationTeamHref('personal', undefined, 'team:team_1')).toBe('/personal/teams/team_1')
  })
})
