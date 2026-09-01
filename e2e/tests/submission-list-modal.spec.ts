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
    await expect(dialog).toContainText('来源：CodeForces · 1000A')
    await expect(dialog).not.toContainText('远端记录')

    const disclosure = dialog.getByRole('button', { name: '详细测试点（2）' })
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await expect(dialog.getByRole('table')).toHaveCount(0)
    await disclosure.click()
    const collapse = dialog.getByRole('button', { name: '收起测试点（2）' })
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await expect(dialog.getByRole('table')).toBeVisible()
    await collapse.press('Enter')
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await disclosure.press('Space')
    await expect(dialog.getByRole('table')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await context.close()
  })

  test('筛选区在桌面和窄屏保持清晰字段结构', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: accounts.personalStudent.storageState,
      viewport: { width: 1600, height: 900 },
    })
    const page = await context.newPage()

    await page.goto('/personal/submissions')
    const toolbar = page.getByRole('search', { name: '评测记录筛选' })
    await expect(toolbar).toBeVisible()

    const controls = [
      toolbar.getByLabel('平台'),
      toolbar.getByLabel('题号'),
      toolbar.getByLabel('评测结果'),
      toolbar.getByLabel('语言'),
    ]
    await expect(toolbar.getByLabel('平台')).toHaveValue('')
    await expect(toolbar.getByLabel('评测结果')).toContainText('全部结果')
    await expect(toolbar.getByLabel('语言')).toContainText('全部语言')

    const desktopBoxes = await Promise.all(controls.map(control => control.boundingBox()))
    expect(desktopBoxes.every(box => box && box.width >= 150)).toBe(true)
    const controlTops = desktopBoxes.map(box => box!.y)
    expect(Math.max(...controlTops) - Math.min(...controlTops)).toBeLessThanOrEqual(2)

    await page.setViewportSize({ width: 600, height: 900 })
    await expect(toolbar).toBeVisible()
    await expect(page.getByRole('button', { name: '重置' })).toBeVisible()
    await expect(page.getByRole('button', { name: '筛选' })).toBeVisible()
    const hasNoPageOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    ))
    expect(hasNoPageOverflow).toBe(true)

    const compactBoxes = await Promise.all(controls.map(control => control.boundingBox()))
    expect(compactBoxes.every(box => box && box.width >= 200)).toBe(true)
    expect(new Set(compactBoxes.map(box => Math.round(box!.y))).size).toBe(2)

    await context.close()
  })

  test('永久权限错误不显示误导性的重试操作', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.personalStudent.storageState })
    const page = await context.newPage()
    await page.route(`**/api/submissions/${ids.personalSubmission}`, route => route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 'SUBMISSION_FORBIDDEN', message: '无权查看该提交记录' }),
    }))

    await page.goto('/personal/submissions')
    const row = page.locator('tbody tr').filter({ hasText: `#${ids.personalSubmission}` })
    await row.getByText(`#${ids.personalSubmission}`, { exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: '无法查看该提交' })).toBeVisible()
    await expect(dialog).toContainText('无权查看该提交记录')
    await expect(dialog.getByRole('button', { name: '重试' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeVisible()
    await context.close()
  })

  test('长内容详情只使用弹窗最外层纵向滚动', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: accounts.personalStudent.storageState,
      viewport: { width: 1280, height: 720 },
    })
    const page = await context.newPage()
    await page.goto('/personal/submissions')
    const row = page.locator('tbody tr').filter({ hasText: `#${ids.personalSubmission}` })
    await row.getByText(`#${ids.personalSubmission}`, { exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const nestedVerticalScrollers = await dialog.locator('pre, [aria-label="源代码"]').evaluateAll(elements => elements.filter(element => {
      const style = getComputedStyle(element)
      return ['auto', 'scroll'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 1
    }).length)
    expect(nestedVerticalScrollers).toBe(0)
    await context.close()
  })
})
