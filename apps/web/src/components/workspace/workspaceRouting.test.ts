import { describe, expect, it } from 'vitest'
import { notificationTeamHref, workspaceHref } from './workspaceRouting'

describe('workspaceHref', () => {
  const personalWorkspace = { type: 'personal' } as never

  it('个人空间不继承校园专属模块', () => {
    expect(workspaceHref(personalWorkspace, 'campus')).toBe('/personal')
    expect(workspaceHref(personalWorkspace, 'students')).toBe('/personal')
  })

  it('个人空间保留自身支持的模块', () => {
    expect(workspaceHref(personalWorkspace, 'contests')).toBe('/personal/contests')
    expect(workspaceHref(personalWorkspace, 'submissions')).toBe('/personal/submissions')
  })

  it('组织空间只进入允许的模块', () => {
    const organizationWorkspace = { type: 'organization', organizationId: 'org_1', availableModules: ['overview', 'contests'] } as never
    expect(workspaceHref(organizationWorkspace, 'contests')).toBe('/org/org_1/contests')
    expect(workspaceHref(organizationWorkspace, 'campus')).toBe('/org/org_1/overview')
    expect(workspaceHref(organizationWorkspace, 'unknown')).toBe('/org/org_1/overview')
  })

  it('通知只为完整的关联资源生成跳转地址', () => {
    expect(notificationTeamHref('personal', 'student', 'team:team_1')).toBe('/personal/teams/team_1')
    expect(notificationTeamHref('work', 'student', 'team:team_1')).toBe('/student/team/team_1')
    expect(notificationTeamHref('work', 'teacher', 'team:team_1')).toBe('/teacher/teams/team_1')
    expect(notificationTeamHref('work', 'teacher', 'organization:org_1')).toBe('/org/org_1/overview')
    expect(notificationTeamHref('work', 'teacher', 'team:')).toBeNull()
    expect(notificationTeamHref('work', 'teacher', undefined)).toBeNull()
  })
})
