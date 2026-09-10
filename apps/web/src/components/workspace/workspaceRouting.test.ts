import { canNavigate, fallbackHref, listHref, notificationTeamHref, resourceHref, workspaceHref } from './workspaceRouting'
import { describe, expect, it } from 'vitest'
import type { WorkspaceSummary } from '@oi-manager/shared'

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
    expect(notificationTeamHref('platform', undefined, 'team:team_1')).toBeNull()
  })
  it('切换工作区时保留知识广场模块', () => {
    const personal: WorkspaceSummary = { type: 'personal', availableModules: [] }
    const campus: WorkspaceSummary = { type: 'organization', organizationId: 'org_1', availableModules: [] }
    expect(workspaceHref(personal, 'knowledge')).toBe('/personal/knowledge')
    expect(workspaceHref(campus, 'knowledge')).toBe('/org/org_1/knowledge')
  })
})
