import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'

test.describe('loading, empty, error and retry states @compact', () => {
  test.use({ storageState: accounts.principal.storageState })

  test('teacher homework list distinguishes a failure and recovers on retry', async ({ page }) => {
    let attempts = 0
    await page.route('**/api/teams?*', async route => {
      attempts += 1
      if (attempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'E2E temporary failure' }),
        })
      } else {
        await route.continue()
      }
    })

    await page.goto('/teacher/homeworks')
    const alert = page.locator('[role="alert"]').filter({ hasText: 'E2E temporary failure' })
    await expect(alert).toContainText('E2E temporary failure')
    await alert.getByRole('button').click()
    await expect(page.getByRole('button', { name: 'E2E Training Team' })).toBeVisible()
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

    await page.goto('/teacher/homeworks')
    await expect(page.locator('body')).toContainText('暂无团队')
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0)
  })
})
