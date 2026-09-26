import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { personalNav, platformAdminNav, schoolManagerNav, studentNav, superAdminNav, teacherNav } from './navigation'
import { hasNavigationIcon } from './navigationIcons'

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

  it('gives every configured navigation item an explicit icon', () => {
    for (const config of [personalNav, studentNav, teacherNav, schoolManagerNav, platformAdminNav, superAdminNav]) {
      expect(config.items.filter(item => !hasNavigationIcon(item.label))).toEqual([])
    }
  })

  it('exposes teacher diagnostics and principal teacher management', () => {
    expect(teacherNav.items).toEqual(expect.arrayContaining([expect.objectContaining({ label: '评测记录', href: 'submissions' })]))
    expect(schoolManagerNav.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '评测记录', href: 'submissions' }),
      expect.objectContaining({ label: '教师与权限', href: 'management?tab=teachers' }),
    ]))
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

  it('keeps authoring in the account menu while the public square is globally reachable', () => {
    const shell = fs.readFileSync(new URL('../components/AppShell.tsx', import.meta.url), 'utf8')
    expect(shell).toContain('个人信息')
    expect(shell).toContain('账号安全')
    expect(shell).toContain('平台绑定')
    expect(shell).toContain('知识广场')
    expect(shell).toContain('我的文章')
    expect(shell).toContain('href="/personal/blogs"')
    expect(shell).toContain('切换身份')
    expect(shell).not.toContain('>我的钱包</Link>')
    expect(shell).not.toContain('>好友与私信</Link>')
  })

  it('keeps knowledge browsing inside user workspaces while platform entries remain public', () => {
    expect(personalNav.items.find(item => item.label === '知识广场')?.href).toBe('/personal/knowledge')
    for (const config of [studentNav, teacherNav, schoolManagerNav]) {
      expect(config.items.find(item => item.label === '知识广场')?.href).toBe('knowledge')
    }
    for (const config of [platformAdminNav, superAdminNav]) {
      expect(config.items.find(item => item.label === '知识广场')).toEqual(expect.objectContaining({ href: '/blog', scope: 'global' }))
    }
  })

  it('keeps AppShell navigation to full sidebar or full drawer without a compact rail', () => {
    const shell = fs.readFileSync(new URL('../components/AppShell.tsx', import.meta.url), 'utf8')
    const styles = fs.readFileSync(new URL('../components/AppShell.module.css', import.meta.url), 'utf8')
    expect(shell).toContain("matchMedia('(min-width: 1100px)')")
    expect(shell).toContain("'expanded' : 'collapsed'")
    expect(shell).toContain("'drawer' : 'closed'")
    expect(shell).not.toContain("'compact'")
    expect(styles).not.toContain('--rail-width')
    expect(styles).not.toContain('.sidebar:not(.sidebarOpen)')
    expect(styles).toContain('@media (min-width: 1100px)')
    const switcherStyles = fs.readFileSync(new URL('../features/workspace/ui/WorkspaceSwitcher.module.css', import.meta.url), 'utf8')
    expect(switcherStyles).toContain('.currentText{display:grid}')
    expect(switcherStyles).not.toContain('.currentText,.trigger>svg{display:none}')
  })
})
