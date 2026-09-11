import { expect, test } from '@playwright/test'

const password = process.env.E2E_LIVE_PASSWORD

async function login(page: import('@playwright/test').Page, username: string, token?: string) {
  if (token) {
    await page.context().addCookies([{ name: 'oi_session', value: token, url: process.env.E2E_LIVE_BASE_URL || 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
    await page.goto('/identity')
    return
  }
  await page.goto('/login')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password!)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

test.beforeAll(() => {
  if (!password && !process.env.E2E_LIVE_PRINCIPAL_TOKEN && !process.env.E2E_LIVE_STUDENT_TOKEN) throw new Error('E2E_LIVE_PASSWORD or scoped live tokens are required for the manual live role suite')
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
  await login(page, process.env.E2E_LIVE_PRINCIPAL || 'teacher1', process.env.E2E_LIVE_PRINCIPAL_TOKEN)
  await expect(page).toHaveURL(/\/identity$/)
  await page.goto('/org/org_school-default/overview')
  await expect(page).toHaveURL(/\/org\/org_school-default\/overview$/)
  await expect(page.getByText('第一中学', { exact: true }).first()).toBeVisible()

  await page.goto('/org/org_school-default/training-sessions')
  await expect(page.getByText('布置和管理学生练习。')).toBeVisible()
  await expect(page.getByRole('button', { name: '创建训练' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /草稿/ })).toBeVisible()
  await expect(page.getByLabel('搜索训练')).toBeVisible()
  await expect(page.getByRole('button', { name: '打开账号菜单' })).toContainText('@teacher1')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.reload()
  await expect(page.getByRole('button', { name: '创建训练' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('school student sees only the learner training experience', async ({ page }) => {
  await login(page, process.env.E2E_LIVE_STUDENT || 'student1', process.env.E2E_LIVE_STUDENT_TOKEN)
  await expect(page).toHaveURL(/\/identity$/)
  await page.goto('/org/org_school-default/training-sessions')
  await expect(page).toHaveURL(/\/org\/org_school-default\/training-sessions$/)
  await expect(page.getByText('查看老师安排的训练并继续练习。')).toBeVisible()
  await expect(page.getByRole('button', { name: '创建训练' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: /进行中/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /即将开始/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /已完成/ })).toBeVisible()
  await expect(page.getByText('教练带练模式')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '切换身份' })).toContainText('学生')
  await expect(page.getByRole('button', { name: '打开账号菜单' })).toContainText('@student1')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('button', { name: '创建训练' })).toHaveCount(0)
  await expect(page.getByText('查看老师安排的训练并继续练习。')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
