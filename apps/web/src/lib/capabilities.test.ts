import { describe, expect, it } from 'vitest'
import { accountCapabilities, hasAccountCapability, isGlobalAdministrator } from './capabilities'

describe('account capability matrix', () => {
  it('keeps both global administrators out of personal and organization workspaces', () => {
    for (const role of ['super_admin', 'platform_admin']) {
      expect(isGlobalAdministrator(role)).toBe(true)
      expect(hasAccountCapability(role, 'enter-personal-workspace')).toBe(false)
      expect(hasAccountCapability(role, 'enter-organization-workspace')).toBe(false)
      expect(hasAccountCapability(role, 'view-all-submissions')).toBe(true)
    }
  })

  it('keeps ordinary account access separate from organization membership access', () => {
    expect(isGlobalAdministrator('user')).toBe(false)
    expect(hasAccountCapability('user', 'enter-personal-workspace')).toBe(true)
    expect(hasAccountCapability('user', 'enter-organization-workspace')).toBe(false)
    expect(hasAccountCapability('user', 'view-all-submissions')).toBe(false)
  })

  it('does not derive organization management from a global account role', () => {
    expect(hasAccountCapability('user', 'manage-organization')).toBe(false)
    expect(hasAccountCapability('super_admin', 'manage-organization')).toBe(false)
    expect(hasAccountCapability('super_admin', 'manage-platform-secrets')).toBe(true)
    expect(hasAccountCapability('platform_admin', 'manage-platform-secrets')).toBe(false)
  })

  it('fails closed for unknown, missing and legacy role strings', () => {
    expect(accountCapabilities(undefined)).toEqual([])
    expect(accountCapabilities('admin')).toEqual([])
    expect(accountCapabilities('school_principal')).toEqual([])
    expect(accountCapabilities('teacher')).toEqual([])
    expect(accountCapabilities('student')).toEqual([])
    expect(hasAccountCapability('admin', 'enter-global-workspace')).toBe(false)
  })
})
