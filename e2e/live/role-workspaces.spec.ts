import { expect, test } from '@playwright/test'

const password = process.env.E2E_LIVE_PASSWORD

async function login(page: import('@playwright/test').Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password!)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

test.beforeAll(() => {
  if (!password) throw new Error('E2E_LIVE_PASSWORD is required for the manual live role suite')
})

test('super admin has one isolated administrator workspace', async ({ page }) => {
  await login(page, process.env.E2E_LIVE_SUPER_ADMIN || 'admin')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.locator('a[href="/admin/schools"]').last()).toBeVisible()
  await expect(page.locator('a[href="/admin/users"]').last()).toBeVisible()
  await expect(page.getByRole('link', { name: '题库管理', exact: true })).toHaveCount(0)

  await page.goto('/platform-admin')
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto('/personal')
  await expect(page).toHaveURL(/\/admin$/)
})

test('platform admin has one isolated platform workspace and global submissions', async ({ page }) => {
  await login(page, process.env.E2E_LIVE_PLATFORM_ADMIN || 'platform_admin')
  await expect(page).toHaveURL(/\/platform-admin$/)
  await expect(page.locator('a[href="/platform-admin/problems"]').last()).toBeVisible()
  await expect(page.locator('a[href="/platform-admin/submissions"]').last()).toBeVisible()
  await expect(page.getByRole('link', { name: '学校管理', exact: true })).toHaveCount(0)

  await page.goto('/platform-admin/submissions')
  await expect(page.getByRole('heading', { name: '评测记录', exact: true })).toBeVisible()
  const response = await page.request.get('/api/submissions?page=1&pageSize=1')
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.data.scope).toBe('all')

  await page.goto('/admin')
  await expect(page).toHaveURL(/\/platform-admin$/)
  await page.goto('/personal')
  await expect(page).toHaveURL(/\/platform-admin$/)
})

test('school principal remains in the organization workspace', async ({ page }) => {
  await login(page, process.env.E2E_LIVE_PRINCIPAL || 'teacher1')
  await expect(page).toHaveURL(/\/identity$/)
  await page.goto('/org/org_school-default/overview')
  await expect(page).toHaveURL(/\/org\/org_school-default\/overview$/)
  await expect(page.getByText('第一中学', { exact: true }).first()).toBeVisible()
})
