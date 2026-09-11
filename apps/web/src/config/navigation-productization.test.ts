import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { personalNav, platformAdminNav, schoolManagerNav, studentNav, teacherNav } from './navigation'

describe('human navigation productization', () => {
  it('gives students direct access to their home and submissions', () => {
    expect(studentNav.items.map(item => item.label)).toEqual(expect.arrayContaining(['首页', '作业', '评测记录']))
    expect(studentNav.items.find(item => item.label === '首页')?.href).toBe('overview')
    expect(studentNav.items.find(item => item.label === '评测记录')?.href).toBe('submissions')
  })

  it('groups personal, school and platform navigation by user intent', () => {
    for (const config of [personalNav, teacherNav, schoolManagerNav, platformAdminNav]) {
      expect(config.items.filter(item => item.href !== config.items[0]?.href).some(item => item.group)).toBe(true)
    }
    expect(teacherNav.items.some(item => item.group === '教学')).toBe(true)
    expect(personalNav.items.some(item => item.group === '资源')).toBe(true)
  })

  it('does not silently render the dashboard for unknown or forbidden organization modules', () => {
    const route = fs.readFileSync(new URL('../app/org/[organizationId]/[module]/page.tsx', import.meta.url), 'utf8')
    const resourceRoute = fs.readFileSync(new URL('../app/org/[organizationId]/[module]/[...segments]/page.tsx', import.meta.url), 'utf8')
    expect(route).toContain('status="403"')
    expect(route).toContain('status="404"')
    expect(route).not.toContain('router.replace(`/org/${organizationId}/overview`)')
    expect(resourceRoute).toContain('status="404"')
    expect(resourceRoute).not.toContain('router.replace(`${prefix}/${module}`)')
  })

  it('keeps account menu limited to account and identity actions', () => {
    const shell = fs.readFileSync(new URL('../components/AppShell.tsx', import.meta.url), 'utf8')
    expect(shell).toContain('个人信息')
    expect(shell).toContain('账号安全')
    expect(shell).toContain('平台绑定')
    expect(shell).toContain('切换身份')
    expect(shell).not.toContain('>我的钱包</Link>')
    expect(shell).not.toContain('>好友与私信</Link>')
  })
})
