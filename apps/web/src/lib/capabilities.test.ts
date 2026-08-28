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

  it('allows ordinary identities to use personal and organization workspaces without global access', () => {
    for (const role of ['school_principal', 'teacher', 'student']) {
      expect(isGlobalAdministrator(role)).toBe(false)
      expect(hasAccountCapability(role, 'enter-personal-workspace')).toBe(true)
      expect(hasAccountCapability(role, 'enter-organization-workspace')).toBe(true)
      expect(hasAccountCapability(role, 'view-all-submissions')).toBe(false)
    }
  })

  it('limits organization management and platform secrets to explicit capabilities', () => {
    expect(hasAccountCapability('school_principal', 'manage-organization')).toBe(true)
    expect(hasAccountCapability('teacher', 'manage-organization')).toBe(false)
    expect(hasAccountCapability('super_admin', 'manage-platform-secrets')).toBe(true)
    expect(hasAccountCapability('platform_admin', 'manage-platform-secrets')).toBe(false)
  })

  it('fails closed for unknown, missing and legacy role strings', () => {
    expect(accountCapabilities(undefined)).toEqual([])
    expect(accountCapabilities('admin')).toEqual([])
    expect(hasAccountCapability('admin', 'enter-global-workspace')).toBe(false)
  })
})
