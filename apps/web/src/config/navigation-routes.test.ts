import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('navigation route reachability', () => {
  it('routes organization problem-list creation before dynamic detail lookup', () => {
    const source = fs.readFileSync(new URL('../app/org/[organizationId]/[module]/[...segments]/page.tsx', import.meta.url), 'utf8')
    const createBranch = source.indexOf("parts[0] === 'new'")
    const detailBranch = source.indexOf('listIdOverride={parts[0]}')
    expect(createBranch).toBeGreaterThan(0)
    expect(detailBranch).toBeGreaterThan(createBranch)
    expect(source).toContain('<NewProblemListPage />')
    expect(source).toContain("userType === 'student'")
  })

  it('provides a real personal problem-note route', () => {
    const route = new URL('../app/personal/problems/[id]/note/page.tsx', import.meta.url)
    expect(fs.existsSync(route)).toBe(true)
    const source = fs.readFileSync(route, 'utf8')
    expect(source).toContain('<ProblemNote role="student"')
  })

  it('keeps problem-list return sources while switching problem tabs', () => {
    const detail = fs.readFileSync(new URL('../features/problem/ui/ProblemDetail.tsx', import.meta.url), 'utf8')
    const list = fs.readFileSync(new URL('../features/problem/ui/ProblemListPage.tsx', import.meta.url), 'utf8')
    expect(list).toContain('returnTo=')
    expect(detail).toContain("requestedReturn?.startsWith")
    expect(detail).toContain("new URLSearchParams(searchParams.toString())")
    expect(detail).toContain("router.replace")
  })

  it('exposes contest attachments as an actual selected tab', () => {
    const source = fs.readFileSync(new URL('../features/contest/ui/ContestDetailPage.tsx', import.meta.url), 'utf8')
    expect(source).toContain("{ value: 'attachments' as const, label: '附件' }")
  })

  it('routes notification actions through the unsaved-change guard', () => {
    for (const path of ['../features/notification/ui/NotificationBell.tsx', '../features/notification/ui/NotificationCenterPage.tsx']) {
      const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8')
      expect(source).toContain('useNavigationGuard')
      expect(source).toContain('requestNavigation(href')
      expect(source).not.toContain('router.push(href)')
    }
  })

  it('provides a guarded return from training design to the same runtime', () => {
    const source = fs.readFileSync(new URL('../features/training-session/ui/TrainingSessionDesigner.tsx', import.meta.url), 'utf8')
    expect(source).toContain('requestNavigation(runtimePath)')
    expect(source).toContain('返回运行工作台')
  })
})
