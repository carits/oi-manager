import { describe, expect, it } from 'vitest'
import { hasOrganizationContext, hasOrganizationWalletAccess, isPlatformAdministrator } from '../src/modules/featureAvailability'

describe('Carits与贡献功能状态', () => {
  it('组织上下文必须匹配当前成员关系', () => {
    const user = { workspaceMode: 'work', organizationId: 'org-a', organizationMembershipId: 'membership-a' } as any
    expect(hasOrganizationContext(user, 'org-a')).toBe(true)
    expect(hasOrganizationContext(user, 'org-b')).toBe(false)
    expect(hasOrganizationContext({ ...user, organizationMembershipId: undefined }, 'org-a')).toBe(false)
  })

  it('平台入口仅接受平台级管理员', () => {
    expect(isPlatformAdministrator({ role: 'platform_admin' } as any)).toBe(true)
    expect(isPlatformAdministrator({ role: 'super_admin' } as any)).toBe(true)
    expect(isPlatformAdministrator({ role: 'school_principal' } as any)).toBe(false)
  })

  it('组织钱包只允许当前组织的教师和负责人', () => {
    const context = { workspaceMode: 'work', organizationId: 'org-a', organizationMembershipId: 'membership-a' }
    expect(hasOrganizationWalletAccess({ ...context, role: 'teacher' } as any, 'org-a')).toBe(true)
    expect(hasOrganizationWalletAccess({ ...context, role: 'school_principal' } as any, 'org-a')).toBe(true)
    expect(hasOrganizationWalletAccess({ ...context, role: 'student' } as any, 'org-a')).toBe(false)
    expect(hasOrganizationWalletAccess({ ...context, role: 'teacher' } as any, 'org-b')).toBe(false)
  })
})
