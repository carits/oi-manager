import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'

test.describe('login and permission boundaries @smoke @compact', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('login role query selects the requested entry', async ({ page }) => {
    await page.goto('/login?role=student')
    await expect(page.getByRole('button', { name: '学生端' })).toHaveCSS(
      'background-color',
      'rgb(37, 99, 235)',
    )
    await expect(page.getByLabel('用户名')).toBeVisible()
    await expect(page.getByLabel('密码')).toBeVisible()
  })

  test('invalid credentials show a user-facing error', async ({ page }) => {
    await page.goto('/login?role=student')
    await page.getByLabel('用户名').fill('student1')
    await page.getByLabel('密码').fill('incorrect-password')
    await page.getByRole('button', { name: '登录' }).click()
    await expect(page.getByText(/用户名或密码错误|登录失败/)).toBeVisible()
  })

  test('anonymous protected route redirects to role login', async ({ page }) => {
    await page.goto('/teacher/teams')
    await expect(page).toHaveURL(/\/login\?role=teacher/)
  })
})

test.describe('authenticated permission matrix @smoke', () => {
  test('student cannot enter teacher or admin areas', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const page = await context.newPage()
    await page.goto('/teacher/teams')
    await expect(page).toHaveURL(/\/student$/)
    await page.goto('/admin/schools')
    await expect(page).toHaveURL(/\/student$/)
    await context.close()
  })

  test('teacher cannot enter administrator areas', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.goto('/platform-admin')
    await expect(page).toHaveURL(/\/teacher$/)
    await context.close()
  })

  test('principal inherits teacher pages', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.principal.storageState })
    const page = await context.newPage()
    await page.goto('/teacher/teachers')
    await expect(page).toHaveURL(/\/teacher\/teachers/)
    await expect(page.locator('body')).not.toContainText('无权限')
    await context.close()
  })

  test('super admin can enter platform administration', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.superAdmin.storageState })
    const page = await context.newPage()
    await page.goto('/platform-admin/problems')
    await expect(page).toHaveURL(/\/platform-admin\/problems/)
    await context.close()
  })

  test('platform admin cannot enter super-admin management pages', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: accounts.platformAdmin.storageState,
    })
    const page = await context.newPage()

    await page.goto('/admin/schools')
    await expect(page).toHaveURL(/\/platform-admin$/)

    await page.goto('/admin/profile')
    await expect(page).toHaveURL(/\/admin\/profile/)
    await context.close()
  })
})
