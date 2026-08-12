import { expect, test } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'
import { assertPageHealth, waitForPageReady, watchPage } from '../support/page-audit'

const entries: Array<{ role: AuthRole; roots: string[] }> = [
  { role: 'principal', roots: ['/teacher', '/teacher/school', '/teacher/students', '/teacher/teachers', '/teacher/teams', '/teacher/homeworks', '/teacher/contests', '/teacher/problems', '/teacher/problem-lists', '/teacher/rankings'] },
  { role: 'teacher', roots: ['/teacher', '/teacher/school', '/teacher/students', '/teacher/teams', '/teacher/homeworks', '/teacher/contests', '/teacher/problems', '/teacher/problem-lists', '/teacher/rankings'] },
  { role: 'campusStudent', roots: ['/student', '/student/school', '/student/team', '/student/homeworks', '/student/contests', '/student/problem-lists', '/student/rating', '/student/submissions'] },
  { role: 'personalStudent', roots: ['/personal', '/personal/teams', '/personal/problems', '/personal/contests', '/personal/problem-lists', '/personal/rankings', '/personal/submissions'] },
]

function isInternalTarget(href: string, origin: string) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return false
  const target = new URL(href, origin)
  return target.origin === origin && !target.pathname.startsWith('/api/') && !/\.(csv|xlsx|zip|pdf)$/i.test(target.pathname)
}

test.describe('全站可见链接真实点击巡检 @smoke', () => {
  for (const entry of entries) {
    test(`${entry.role} 从模块页实际点击所有发现的内部链接`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ storageState: accounts[entry.role].storageState, viewport: { width: 1440, height: 900 } })
      const page = await context.newPage()
      const origin = new URL(testInfo.project.use.baseURL as string).origin
      const visitedTargets = new Set<string>()
      const detailTargets = new Set<string>()
      const auditTrail: Array<Record<string, string>> = []

      const inspectLinks = async (source: string, followDetailLinks: boolean) => {
        const sourceAudit = watchPage(page)
        await test.step(`${entry.role} 打开 ${source}`, async () => {
          await page.goto(source)
          await waitForPageReady(page)
          await assertPageHealth(page, sourceAudit, { checkAccessibility: false })
        })

        const links = await page.locator('a:visible').evaluateAll(anchors => anchors.map(anchor => ({
          href: (anchor as HTMLAnchorElement).getAttribute('href') || '',
          label: (anchor.textContent || anchor.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        })))
        for (const link of links) {
          if (!isInternalTarget(link.href, origin)) continue
          const target = new URL(link.href, origin)
          if (target.pathname === new URL(source, origin).pathname && target.search) continue
          const destination = `${target.pathname}${target.search}`
          if (followDetailLinks && /\/\d+(?:$|\?)/.test(destination)) detailTargets.add(destination)
          if (visitedTargets.has(destination)) continue
          visitedTargets.add(destination)

          await test.step(`${source} 点击 ${link.label || link.href}`, async () => {
            await page.goto(source)
            await waitForPageReady(page)
            const clickAudit = watchPage(page)
            const anchor = page.locator(`a[href="${link.href}"]:visible`).first()
            await expect(anchor).toBeVisible()
            await anchor.click()
            await waitForPageReady(page)
            auditTrail.push({ source, label: link.label, href: link.href, destination: page.url() })
            await assertPageHealth(page, clickAudit, { checkAccessibility: false })
          })
        }
      }

      for (const source of entry.roots) {
        await inspectLinks(source, true)
      }
      // Dynamic detail pages are where breadcrumbs and post-action return links live.
      // Inspect their visible links once, without recursively expanding arbitrary lists.
      for (const source of detailTargets) {
        await inspectLinks(source, false)
      }

      await testInfo.attach('内部链接点击记录', { body: JSON.stringify(auditTrail, null, 2), contentType: 'application/json' })
      await context.close()
    })
  }
})
