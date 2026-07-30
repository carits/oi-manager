import { describe, expect, it } from 'vitest'
import { getRoleHome, roleHasAccess } from './roleAccess'

describe('role access', () => {
  it('does not let platform admins satisfy a super-admin requirement', () => {
    expect(roleHasAccess('platform_admin', 'super_admin')).toBe(false)
  })

  it('supports the intentional role hierarchies', () => {
    expect(roleHasAccess('super_admin', 'platform_admin')).toBe(true)
    expect(roleHasAccess('school_principal', 'teacher')).toBe(true)
    expect(roleHasAccess('student', 'teacher')).toBe(false)
  })

  it('uses canonical role home paths', () => {
    expect(getRoleHome('super_admin')).toBe('/admin/schools')
    expect(getRoleHome('platform_admin')).toBe('/platform-admin')
    expect(getRoleHome('school_principal')).toBe('/teacher')
    expect(getRoleHome('student')).toBe('/student')
  })
})
