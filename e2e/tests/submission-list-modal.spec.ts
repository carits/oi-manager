import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()

test.describe('评测记录列表详情弹窗 @smoke', () => {
  test('个人提交行在原列表打开详情弹窗', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.personalStudent.storageState })
    const page = await context.newPage()

    await page.goto('/personal/submissions')
    await expect(page.getByRole('heading', { name: '评测记录' })).toBeVisible()
    const listUrl = page.url()
    const row = page.locator('tbody tr').filter({ hasText: `#${ids.personalSubmission}` })
    await expect(row).toBeVisible()

    await row.getByText(`#${ids.personalSubmission}`, { exact: true }).click()

    await expect(page).toHaveURL(listUrl)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(`#${ids.personalSubmission}`)
    await expect(dialog).toContainText('评测结果')

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await context.close()
  })
})
