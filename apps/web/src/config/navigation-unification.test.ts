import { describe, expect, it } from 'vitest'
import { getActiveNavItem, getNavConfig } from './navigation'

describe('navigation hierarchy', () => {
  it.each(['teacher', 'school_principal'])('keeps student management prominent with one school-management parent for %s', role => {
    const items = getNavConfig(role, 'organization').items
    expect(items.filter(item => item.href.startsWith('management'))).toEqual([
      expect.objectContaining({ label: '学生', href: 'management?tab=students' }),
      expect.objectContaining({ label: '学校管理', href: 'management?tab=applications' }),
    ])
    expect(getActiveNavItem('/org/a/management', role, 'organization')).toBe('学生')
    expect(getActiveNavItem('/org/a/management?tab=students', role, 'organization')).toBe('学生')
    for (const tab of ['teachers', 'applications', 'invitations', 'settings', 'wallet']) {
      expect(getActiveNavItem(`/org/a/management?tab=${tab}`, role, 'organization')).toBe('学校管理')
    }
  })
  it('does not show management navigation to students or an unresolved role', () => {
    expect(getNavConfig('student', 'organization').items.some(item => item.href.startsWith('management'))).toBe(false)
    expect(getNavConfig('', 'organization').items).toEqual([])
  })
  it.each([['super_admin', '/admin'], ['platform_admin', '/platform-admin']])('keeps %s knowledge navigation in its current workspace', (role, prefix) => {
    expect(getNavConfig(role, 'platform').items.find(item => item.label === '知识广场')?.href).toBe(`${prefix}/knowledge`)
  })
  it('uses the most-specific destination instead of highlighting the entire workspace', () => {
    expect(getActiveNavItem('/personal/problems/42?tab=statement', 'user', 'personal')).toBe('题库')
    expect(getActiveNavItem('/personal/unknown', 'user', 'personal')).toBe('')
  })
})
