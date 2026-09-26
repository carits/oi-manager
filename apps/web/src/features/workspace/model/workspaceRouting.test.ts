import { canNavigate, fallbackHref, listHref, notificationTeamHref, organizationUnavailableMessage, resolveNotificationHref, resourceHref, workspaceHref, workspaceRoleLabel } from './workspaceRouting'
import { describe, expect, it } from 'vitest'
import type { WorkspaceSummary } from '@oi-manager/contracts'

describe('组织路由能力', () => {
  const organization = { workspace: 'organization' as const, organizationId: 'org_1', accountRole: 'user', organizationRole: 'student' }

  it('只生成组织和个人规范路径', () => {
    expect(resourceHref('team', organization, 'team_1')).toBe('/org/org_1/teams/team_1')
    expect(resourceHref('contest', organization, 18)).toBe('/org/org_1/contests/18')
    expect(resourceHref('submission', organization, 9)).toBe('/org/org_1/submissions/9')
    expect(listHref('homework', organization)).toBe('/org/org_1/homeworks')
    expect(listHref('training', organization)).toBe('/org/org_1/training-sessions')
    expect(notificationTeamHref('organization', 'org_1', 'team:team_1')).toBe('/org/org_1/teams/team_1')
  })

  it('缺少组织上下文时拒绝生成资源地址', () => {
    expect(resourceHref('team', { workspace: 'organization', accountRole: 'user', organizationRole: 'teacher' }, 'team_1')).toBeNull()
    expect(fallbackHref({ workspace: 'organization', accountRole: 'user', organizationRole: 'teacher' })).toBe('/identity')
    expect(canNavigate(null)).toBe(false)
  })

  it('个人路径保持隔离', () => {
    const personal = { workspace: 'personal' as const, accountRole: 'user' }
    expect(resourceHref('team', personal, 'team_1')).toBe('/personal/teams/team_1')
    expect(listHref('contest', personal)).toBe('/personal/contests')
    expect(listHref('training', personal)).toBe('/personal/training-sessions')
    expect(notificationTeamHref('personal', undefined, 'team:team_1')).toBe('/personal/teams/team_1')
    expect(notificationTeamHref('platform', undefined, 'team:team_1')).toBeNull()
    expect(resolveNotificationHref('organization', 'org_1', '/account/notifications')).toBe('/account/notifications')
    expect(resolveNotificationHref('organization', 'org_1', 'team:team_1')).toBe('/org/org_1/teams/team_1')
  })

  it('切换工作区时保留合法模块和管理子视图', () => {
    const personal: WorkspaceSummary = { type: 'personal', availableModules: [] }
    const campus: WorkspaceSummary = {
      type: 'organization', organizationId: 'org_1', organizationName: '学校', organizationType: 'school',
      organizationMembershipId: 'membership-1', memberRole: 'student', relationType: 'enrolled',
      relationLabel: '本校学生', availableModules: [],
    }
    expect(workspaceHref(personal, 'knowledge')).toBe('/personal/knowledge')
    expect(workspaceHref(campus, 'knowledge')).toBe('/org/org_1/knowledge')
    expect(workspaceHref({ ...campus, availableModules: ['submissions'] }, 'submissions')).toBe('/org/org_1/submissions')
    expect(workspaceHref({ ...campus, relationLabel: '学校负责人', availableModules: ['management'] }, 'management', 'tab=wallet')).toBe('/org/org_1/management?tab=wallet')
    expect(workspaceHref({ ...campus, relationLabel: '本校学生', availableModules: ['management'] }, 'management', 'tab=teachers')).toBe('/org/org_1/management')
  })

  it('将组织角色枚举转换为中文显示名称', () => {
    expect(workspaceRoleLabel('student')).toBe('学生')
    expect(workspaceRoleLabel('teacher')).toBe('教师')
    expect(workspaceRoleLabel('school_principal')).toBe('负责人')
  })

  it('用安全文案解释学校身份失效原因', () => {
    expect(organizationUnavailableMessage('ORGANIZATION_ACCESS_DENIED')).toContain('移除或停用')
    expect(organizationUnavailableMessage('ORGANIZATION_NOT_AVAILABLE')).toContain('学校当前不可用')
    expect(organizationUnavailableMessage('UNKNOWN')).toContain('身份已失效')
  })
})
