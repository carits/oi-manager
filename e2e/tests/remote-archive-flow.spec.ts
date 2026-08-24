import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()

test('external problem archive mode is separate from local code judging', async ({ browser }) => {
  const context = await browser.newContext({ storageState: accounts.personalStudent.storageState })
  const page = await context.newPage()
  let archivePayload: unknown = null

  await page.route('**/api/platform-bindings/codeforces/sync-submissions', async route => {
    archivePayload = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '该题提交记录已存在',
        data: { firstSubmission: null, totalCount: 1, pendingCount: 0, skipped: 1 },
      }),
    })
  })
  await page.route('**/api/platform-bindings/codeforces', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { bound: true, platformUsername: 'e2e_cf_user' },
      }),
    })
  })

  await page.goto(`/personal/problems/${ids.personalProblem}`)
  await expect(page.getByRole('heading', { name: 'E2E Personal Problem' })).toBeVisible()
  await page.getByRole('button', { name: /提交代码/ }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(/CodeForces 1000A/i)
  await expect(dialog.getByRole('button', { name: '本地评测' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '同步归档' })).toBeVisible()
  await expect(dialog.locator('textarea')).toBeVisible()

  await dialog.getByRole('button', { name: '同步归档' }).first().click()
  await expect(dialog).toContainText('已绑定: e2e_cf_user')
  await expect(dialog.locator('textarea')).toHaveCount(0)
  await expect(dialog).toContainText('远程归档：只同步展示，不参与评测或计分')

  await dialog.getByRole('button', { name: '同步归档' }).last().click()
  await expect(page.getByText('该题提交记录已存在')).toBeVisible()
  expect(archivePayload).toEqual({ problemId: '1000A' })

  await context.close()
})
