import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'

const organizationBase = '/org/org_school-default'

test.describe('problem library source partition @smoke @compact', () => {
  test('personal and teacher platform libraries separate Carits from other sources', async ({ browser }) => {
    const personalContext = await browser.newContext({ storageState: accounts.personalStudent.storageState })
    const personalPage = await personalContext.newPage()

    await personalPage.goto('/personal/problems')
    await expect(personalPage.getByRole('heading', { name: '题库' })).toBeVisible()
    await expect(personalPage.getByRole('tab', { name: 'Carits 平台题库' })).toHaveAttribute('aria-selected', 'true')
    await expect(personalPage.getByText('E2E A Plus B', { exact: true })).toBeVisible()
    await expect(personalPage.getByText('E2E Personal Problem', { exact: true })).toHaveCount(0)
    await expect(personalPage.getByRole('columnheader', { name: '来源平台' })).toHaveCount(0)

    const search = personalPage.getByLabel('搜索题目')
    await search.fill('E2E')
    await search.press('Enter')
    await expect(personalPage).toHaveURL(/keyword=E2E/)
    await personalPage.getByRole('tab', { name: '其他题库' }).click()
    await expect(personalPage).toHaveURL(/source=external/)
    await expect(personalPage).toHaveURL(/keyword=E2E/)
    await expect(search).toHaveValue('E2E')
    await expect(personalPage.getByText('E2E Personal Problem', { exact: true })).toBeVisible()
    await expect(personalPage.getByText('E2E A Plus B', { exact: true })).toHaveCount(0)
    await expect(personalPage.getByRole('columnheader', { name: '来源平台' })).toBeVisible()

    const platformFilter = personalPage.getByLabel('来源平台')
    await expect(platformFilter.locator('option').first()).toHaveText('全部其他平台')
    await expect(platformFilter.locator('option', { hasText: 'Carits平台' })).toHaveCount(0)
    await platformFilter.selectOption('codeforces')
    await expect(personalPage).toHaveURL(/platform=codeforces/)
    await expect(personalPage.getByText('E2E Personal Problem', { exact: true })).toBeVisible()
    await personalPage.getByRole('tab', { name: 'Carits 平台题库' }).click()
    await expect(personalPage).not.toHaveURL(/platform=codeforces/)
    await expect(personalPage).not.toHaveURL(/source=external/)
    await expect(personalPage).toHaveURL(/keyword=E2E/)
    await personalContext.close()

    const teacherContext = await browser.newContext({ storageState: accounts.teacher.storageState })
    const teacherPage = await teacherContext.newPage()
    await teacherPage.goto(`${organizationBase}/problems?library=platform`)
    await expect(teacherPage.getByRole('tab', { name: '平台题库', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(teacherPage.getByRole('tab', { name: 'Carits 平台题库' })).toHaveAttribute('aria-selected', 'true')
    await expect(teacherPage.getByText('E2E A Plus B', { exact: true })).toBeVisible()
    await teacherPage.getByRole('tab', { name: '其他题库' }).click()
    const externalRow = teacherPage.locator('tbody tr').filter({ hasText: 'E2E Personal Problem' })
    await expect(externalRow).toHaveCount(1)
    await expect(externalRow.getByRole('button', { name: '复制到校内' })).toBeVisible()

    await teacherPage.getByRole('tab', { name: '校内题库', exact: true }).click()
    await expect(teacherPage.getByRole('heading', { name: '校内题库' })).toBeVisible()
    await expect(teacherPage.getByRole('tab', { name: 'Carits 平台题库' })).toHaveCount(0)
    await expect(teacherPage.getByRole('tab', { name: '其他题库' })).toHaveCount(0)
    await teacherContext.close()
  })

  test('source tabs do not create horizontal overflow on mobile', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: accounts.personalStudent.storageState,
      viewport: { width: 390, height: 844 },
    })
    const page = await context.newPage()
    await page.goto('/personal/problems?source=external')
    await expect(page.getByRole('tab', { name: '其他题库' })).toHaveAttribute('aria-selected', 'true')
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(hasHorizontalOverflow).toBe(false)
    await context.close()
  })
})
