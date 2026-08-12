import { describe, expect, it } from 'vitest'
import { canNavigate, fallbackHref, isProhibitedPath, listHref, moduleHref, notificationHref, notificationTeamHref, resourceHref, workspaceHref } from './workspaceRouting'

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

  it('校级比赛只生成真实详情页和真实列表页', () => {
    const teacher = { workspaceMode: 'work', role: 'teacher', schoolScoped: true } as const
    const student = { workspaceMode: 'work', role: 'student', schoolScoped: true } as const
    expect(resourceHref('contest', teacher, 18)).toBe('/teacher/school/contests/18')
    expect(resourceHref('contest', student, 18)).toBe('/student/school/contests/18')
    expect(listHref('contest', teacher)).toBe('/teacher/contests')
    expect(listHref('contest', student)).toBe('/student/contests')
    expect(isProhibitedPath('/teacher/school/contests')).toBe(true)
    expect(isProhibitedPath('/student/school/contests')).toBe(true)
  })

  it('缺失资源标识时不生成跳转地址', () => {
    expect(canNavigate('')).toBe(false)
    expect(canNavigate(undefined)).toBe(false)
    expect(resourceHref('contest', { workspaceMode: 'work', role: 'teacher', schoolScoped: true }, null)).toBeNull()
  })
  it('keeps unified navigation aliases safe', () => {
    const workspace = { type: 'personal' } as never
    expect(fallbackHref({ workspaceMode: 'work', role: 'student' })).toBe('/student')
    expect(fallbackHref({ workspaceMode: 'personal', role: 'student' })).toBe('/personal')
    expect(moduleHref(workspace, 'contests')).toBe(workspaceHref(workspace, 'contests'))
    expect(notificationHref('work', 'teacher', 'team:team_1')).toBe(notificationTeamHref('work', 'teacher', 'team:team_1'))
  })

  it('does not treat a personal contest id as a team id', () => {
    expect(listHref('contest', { workspaceMode: 'personal', role: 'student' })).toBe('/personal/contests')
  })
})
