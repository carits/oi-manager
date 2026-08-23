import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'

const organizationBase = '/org/org_school-default'

test.describe('school problem library permissions @smoke', () => {
  test('teacher can use the school and platform library tabs', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()

    await page.goto(`${organizationBase}/problems?library=school`)
    await expect(page.getByRole('heading', { name: '校内题库' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '校内题库' })).toHaveAttribute('aria-selected', 'true')

    const schoolRow = page.locator('tbody tr').filter({ hasText: 'E2E Sequence' })
    await expect(schoolRow).toHaveCount(1)
    await expect(schoolRow.getByRole('button', { name: '查看' })).toBeVisible()
    await expect(schoolRow.getByRole('button', { name: '编辑' })).toBeVisible()

    await page.goto(`${organizationBase}/problems?library=platform`)
    await expect(page.getByRole('heading', { name: '平台题库' })).toBeVisible()
    const platformRow = page.locator('tbody tr').filter({ hasText: 'E2E A Plus B' })
    await expect(platformRow).toHaveCount(1)
    await expect(platformRow.getByRole('button', { name: '复制到校内' })).toBeVisible()

    await context.close()
  })

  test('principal receives management actions for school problems', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.principal.storageState })
    const page = await context.newPage()

    await page.goto(`${organizationBase}/problems?library=school`)
    const schoolRow = page.locator('tbody tr').filter({ hasText: 'E2E Sequence' })
    await expect(schoolRow).toHaveCount(1)
    await expect(schoolRow.getByRole('button', { name: '查看' })).toBeVisible()
    await expect(schoolRow.getByRole('button', { name: '编辑' })).toBeVisible()

    await context.close()
  })

  test('student has no campus problem library', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const page = await context.newPage()

    await page.goto(`${organizationBase}/overview`)
    await expect(page.getByRole('link', { name: '题库', exact: true })).toHaveCount(0)
    await page.goto(`${organizationBase}/problems`)
    await expect(page).toHaveURL(new RegExp(`${organizationBase.replaceAll('/', '\\/')}\/overview$`))

    await context.close()
  })

  test('platform administrator cannot enter a school library', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.platformAdmin.storageState })
    const page = await context.newPage()

    await page.goto(`${organizationBase}/problems?library=school`)
    await expect(page).toHaveURL(/\/platform-admin$/)
    await page.goto('/platform-admin/problems')
    await expect(page.getByRole('heading', { name: '题库管理' })).toBeVisible()
    await expect(page.getByRole('tab', { name: '校内题库' })).toHaveCount(0)

    await context.close()
  })
})
