import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()
const organizationBase = `/org/org_${ids.school}`

test.describe('response budgets', () => {
  test.use({ storageState: accounts.principal.storageState })

  test('assignment first view stays within the business request budget', async ({ page }) => {
    const businessRequests: string[] = []
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/')) {
        businessRequests.push(url.pathname)
      }
    })

    await page.goto(`${organizationBase}/homeworks/${ids.homework}`)
    await expect(page.getByRole('heading', { name: 'E2E Active Homework' })).toBeVisible()
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)

    const workspacePath = `/api/assignments/${ids.homework}/workspace`
    expect(businessRequests.filter(path => path === workspacePath)).toHaveLength(1)
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
      await page.goto(`${organizationBase}/homeworks/${ids.homework}`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(page.getByRole('button', { name: /显示导航|隐藏导航/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: /作业|E2E Active Homework/ })).toBeVisible()

      // Keep a narrow allowance for Playwright assertion scheduling; the slower
      // network profile must still render the shell near the two-second budget.
      expect(Date.now() - startedAt).toBeLessThanOrEqual(2_250)
      await expect(page.locator('body')).not.toContainText('加载中')
    })
  }
})
