import { expect, test } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'
import {
  compactPatterns,
  resolveRoute,
  routeOwner,
  routePatterns,
  type RouteOwner,
} from '../fixtures/routes'
import { installExternalMocks } from '../fixtures/external-mocks'
import { uxRouteMap } from '../fixtures/ux-matrix'
import {
  assertPageHealth,
  assertVisibleControlsFit,
  waitForPageReady,
  watchPage,
} from '../support/page-audit'

const fixtures = loadFixtureIds()
const smokePatterns = new Set([
  '/',
  '/login',
  '/admin/schools',
  '/platform-admin',
  '/platform-admin/problems',
  '/org/[organizationId]/[module]',
  '/org/[organizationId]/[module]/[...segments]',
])

const owners: RouteOwner[] = [
  'public',
  'superAdmin',
  'platformAdmin',
  'principal',
  'campusStudent',
  'personalStudent',
]

for (const owner of owners) {
  test.describe(`${owner} pages`, () => {
    if (owner === 'public') test.use({ storageState: { cookies: [], origins: [] } })
    else test.use({ storageState: accounts[owner as AuthRole].storageState })

    const routes = routePatterns.filter(pattern => routeOwner(pattern) === owner)
    for (const pattern of routes) {
      const suffix = [
        smokePatterns.has(pattern) ? '@smoke' : '',
        compactPatterns.has(pattern) ? '@compact' : '',
      ].filter(Boolean).join(' ')

      test(`${pattern} renders ${suffix}`, async ({ page }) => {
        const ux = uxRouteMap.get(pattern)
        if (!ux) throw new Error(`Missing UX matrix entry for ${pattern}`)
        const audit = watchPage(page)
        await installExternalMocks(page)
        await page.goto(resolveRoute(pattern, fixtures), { waitUntil: 'domcontentloaded' })
        await waitForPageReady(page)
        await assertPageHealth(page, audit, { checkAccessibility: smokePatterns.has(pattern) })
        if (compactPatterns.has(pattern)) await assertVisibleControlsFit(page)

        if (owner !== 'public') {
          await expect(page.locator('#app-sidebar')).toHaveCount(1)
          await expect(page.locator('h1, h2').first()).toBeVisible()
        }

        const unlabeledIconButtons = await page.locator('button:visible').evaluateAll(buttons =>
          buttons.filter(button => {
            const text = button.textContent?.trim()
            return !text && !button.getAttribute('aria-label') && !button.getAttribute('title')
          }).length,
        )
        expect(unlabeledIconButtons, `${pattern} has unlabeled icon buttons`).toBe(0)

        const firstControl = page.locator('a:visible, button:visible, input:visible, select:visible').first()
        if (await firstControl.count()) {
          await firstControl.focus()
          await expect(firstControl).toBeFocused()
        }
      })
    }
  })
}
