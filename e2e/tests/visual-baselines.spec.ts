import { expect, test, type Browser } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'
import { installExternalMocks } from '../fixtures/external-mocks'

const ids = loadFixtureIds()

async function capture(
  browser: Browser,
  role: AuthRole,
  url: string,
  snapshot: string,
) {
  const context = await browser.newContext({ storageState: accounts[role].storageState })
  const page = await context.newPage()
  await installExternalMocks(page)
  await page.goto(url)
  await expect(page.locator('body')).toBeVisible()
  await expect(page).toHaveScreenshot(snapshot, {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.01,
  })
  await context.close()
}

test.describe('stable desktop visual baselines', () => {
  test('login', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveScreenshot('login.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    })
  })

  test('role home pages', async ({ browser }) => {
    await capture(browser, 'superAdmin', '/admin', 'super-admin-home.png')
    await capture(browser, 'platformAdmin', '/platform-admin', 'platform-admin-home.png')
    await capture(browser, 'principal', '/teacher', 'teacher-home.png')
    await capture(browser, 'campusStudent', '/student', 'student-home.png')
  })

  test('major list and detail pages', async ({ browser }) => {
    await capture(browser, 'principal', '/teacher/problem-lists', 'problem-lists.png')
    await capture(
      browser,
      'principal',
      `/teacher/problem-lists/${ids.problemList}`,
      'problem-list-detail.png',
    )
    await capture(
      browser,
      'campusStudent',
      `/student/submissions/${ids.submission}`,
      'submission-detail.png',
    )
  })
})
