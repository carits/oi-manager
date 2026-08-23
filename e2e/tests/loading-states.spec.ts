import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()
const organizationBase = `/org/org_${ids.school}`

test.describe('loading, empty, error and retry states @compact', () => {
  test.use({ storageState: accounts.principal.storageState })

  test('teacher homework list distinguishes a failure and recovers on retry', async ({ page }) => {
    let attempts = 0
    let recover = false
    await page.route('**/api/teams?*', async route => {
      attempts += 1
      if (!recover) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'E2E temporary failure' }),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto(`${organizationBase}/homeworks`)
    const alert = page.locator('[role="alert"]').filter({ hasText: 'E2E temporary failure' })
    await expect(alert).toContainText('E2E temporary failure')
    recover = true
    await alert.getByRole('button').click()
    await expect(page.getByRole('combobox', { name: '团队范围' })).toHaveValue(ids.team)
    expect(attempts).toBeGreaterThanOrEqual(2)
  })

  test('teacher homework list renders a true empty state', async ({ page }) => {
    await page.route('**/api/teams?*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { items: [] } }),
      }),
    )

    await page.goto(`${organizationBase}/homeworks`)
    await expect(page.locator('body')).toContainText('暂无团队')
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0)
  })

  test('training shell stays visible while the overview request is delayed', async ({ page }) => {
    await page.route(`**/api/trainings/${ids.homework}/overview`, async route => {
      await new Promise(resolve => setTimeout(resolve, 3000))
      await route.continue()
    })

    await page.goto(`${organizationBase}/homeworks/${ids.homework}`, {
      waitUntil: 'domcontentloaded',
    })

    await expect(page.getByRole('navigation')).toBeVisible()
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible()
    await expect(page.locator('body')).not.toContainText('加载中')
    await expect(page.locator('body')).toContainText('E2E Active Homework', { timeout: 8000 })
  })

  test('a stalled overview becomes a retryable error instead of waiting forever', async ({ page }) => {
    await page.route(`**/api/trainings/${ids.homework}/overview`, async route => {
      await new Promise(resolve => setTimeout(resolve, 5000))
      await route.continue()
    })

    await page.goto(`${organizationBase}/homeworks/${ids.homework}`)
    const alert = page.locator('[role="alert"]').filter({ hasText: /超时|重试/ })
    await expect(alert).toBeVisible({ timeout: 6000 })
    await expect(alert.getByRole('button', { name: '重试' })).toBeVisible()
  })
})
