import { test } from '@playwright/test'
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
  '/teacher',
  '/teacher/students',
  '/teacher/teams',
  '/teacher/homeworks',
  '/student',
  '/student/team',
  '/student/homeworks',
  '/student/problems',
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
        const audit = watchPage(page)
        await installExternalMocks(page)
        await page.goto(resolveRoute(pattern, fixtures), { waitUntil: 'domcontentloaded' })
        await waitForPageReady(page)
        await assertPageHealth(page, audit)
        if (compactPatterns.has(pattern)) await assertVisibleControlsFit(page)
      })
    }
  })
}
