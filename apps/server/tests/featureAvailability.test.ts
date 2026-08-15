import { describe, expect, it } from 'vitest'
import { hasOrganizationContext, isPlatformAdministrator, plannedFeatureResponse } from '../src/modules/featureAvailability'

describe('Carits与贡献功能状态', () => {
  it('只返回计划状态，不伪造余额或贡献值', () => {
    const result = plannedFeatureResponse('carits', 'personal')
    expect(result.featureStatus).toBe('planned')
    expect(result).not.toHaveProperty('balance')
    expect(result.items).toEqual([])
  })

  it('组织上下文必须匹配当前成员关系', () => {
    const user = { workspaceMode: 'work', organizationId: 'org-a', organizationMembershipId: 'membership-a' } as any
    expect(hasOrganizationContext(user, 'org-a')).toBe(true)
    expect(hasOrganizationContext(user, 'org-b')).toBe(false)
    expect(hasOrganizationContext({ ...user, organizationMembershipId: undefined }, 'org-a')).toBe(false)
  })

  it('平台入口仅接受平台级管理员', () => {
    expect(isPlatformAdministrator({ role: 'platform_admin' } as any)).toBe(true)
    expect(isPlatformAdministrator({ role: 'school_principal' } as any)).toBe(false)
  })
})
