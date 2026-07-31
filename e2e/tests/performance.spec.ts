import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()

test.describe('response budgets', () => {
  test.use({ storageState: accounts.principal.storageState })

  test('training first view stays within the business request budget', async ({ page }) => {
    const businessRequests: string[] = []
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/')) {
        businessRequests.push(url.pathname)
      }
    })

    await page.goto(`/teacher/teams/${ids.team}/homeworks/${ids.homework}`)
    await expect(page.getByRole('heading', { name: 'E2E Active Homework' })).toBeVisible()
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)

    const overviewPath = `/api/trainings/${ids.homework}/overview`
    expect(businessRequests.filter(path => path === overviewPath)).toHaveLength(1)
    expect(
      businessRequests.length,
      `business requests exceeded the budget:\n${businessRequests.join('\n')}`,
    ).toBeLessThanOrEqual(5)
  })

  for (const profile of [
    { name: '1 Mbps', downloadThroughput: 125_000 },
    { name: '5 Mbps', downloadThroughput: 625_000 },
  ]) {
    test(`${profile.name} shows navigation and the page frame within two seconds`, async ({
      page,
      context,
    }) => {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 80,
        downloadThroughput: profile.downloadThroughput,
        uploadThroughput: profile.downloadThroughput,
        connectionType: 'cellular3g',
      })

      const startedAt = Date.now()
      await page.goto(`/teacher/teams/${ids.team}/homeworks/${ids.homework}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByRole('navigation')).toBeVisible()
      await expect(page.getByRole('heading', { name: /作业详情|E2E Active Homework/ })).toBeVisible()

      expect(Date.now() - startedAt).toBeLessThanOrEqual(2_000)
      await expect(page.locator('body')).not.toContainText('加载中')
    })
  }
})
