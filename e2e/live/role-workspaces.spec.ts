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
  await expect(page.getByRole('heading', { name: '学校工作概览' })).toBeVisible()
  const principalNavigation = page.getByRole('navigation', { name: '学校负责人主导航' })
  await expect(principalNavigation.getByRole('link', { name: '教师与权限' })).toBeVisible()
  await expect(principalNavigation.getByRole('link', { name: '评测记录' })).toBeVisible()

  await page.goto('/org/org_school-default/training-sessions')
  await expect(page.getByText('布置和管理学生练习。')).toBeVisible()
  await expect(page.getByRole('button', { name: '创建训练' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /草稿/ })).toBeVisible()
  await expect(page.getByLabel('筛选团队')).toBeVisible()
  await expect(page.getByLabel('筛选团队').locator('option')).not.toHaveCount(0)
  await expect(page.getByLabel('搜索训练')).toBeVisible()
  const trainingResponse = await page.request.get('/api/training-sessions?organizationId=org_school-default', { headers: { 'X-OI-Organization-ID': 'org_school-default' } })
  expect(trainingResponse.status()).toBe(200)
  const trainingBody = await trainingResponse.json()
  expect(trainingBody.data.some((item: { teamId?: string | null }) => Boolean(item.teamId))).toBe(true)
  expect(trainingBody.data.every((item: { problemCount?: number }) => typeof item.problemCount === 'number')).toBe(true)
  await expect(page.getByRole('button', { name: '打开账号菜单' })).toContainText('@teacher1')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.reload()
  await expect(page.getByRole('button', { name: '创建训练' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('school principal gets the five-step contest wizard and scoped problem picker', async ({ page }) => {
  await login(page, process.env.E2E_LIVE_PRINCIPAL || 'teacher1', process.env.E2E_LIVE_PRINCIPAL_TOKEN)
  await page.goto('/org/org_school-default/contests')
  await expect(page.getByLabel('比赛范围')).toBeVisible()
  await page.getByRole('button', { name: '创建比赛' }).click()
  await expect(page.getByRole('heading', { name: '创建比赛' })).toBeVisible()
  await expect(page.getByRole('button', { name: '1. 基本信息' })).toBeVisible()
  await expect(page.getByRole('button', { name: '2. 赛制与 Rating' })).toBeVisible()
  await expect(page.getByRole('button', { name: '3. 题目' })).toBeVisible()
  await expect(page.getByRole('button', { name: '4. 可见性' })).toBeVisible()
  await expect(page.getByRole('button', { name: '5. 发布前检查' })).toBeVisible()
  await page.getByPlaceholder('比赛名称').fill('仅用于界面验收')
  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByLabel('Rating 范围')).toBeVisible()
  await page.getByRole('button', { name: '下一步' }).click()
  await expect(page.getByRole('button', { name: '选择题目' })).toBeVisible()
  await page.getByRole('button', { name: '选择题目' }).click()
  await expect(page.getByRole('heading', { name: '选择比赛题目' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '校内题库' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Carits 平台题库' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '其他题库' })).toBeVisible()
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

  await page.goto('/org/org_school-default/overview')
  await expect(page.getByText('包含作业、训练和比赛')).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/org/org_school-default/training-sessions')
  await expect(page.getByRole('button', { name: '创建训练' })).toHaveCount(0)
  await expect(page.getByText('查看老师安排的训练并继续练习。')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('school student assignment list defaults to active server pagination', async ({ page }) => {
  await login(page, process.env.E2E_LIVE_STUDENT || 'student1', process.env.E2E_LIVE_STUDENT_TOKEN)
  const responsePromise = page.waitForResponse(response => response.url().includes('/api/assignments?') && response.url().includes('statusGroup=active'))
  await page.goto('/org/org_school-default/homeworks')
  const response = await responsePromise
  expect(response.status()).toBe(200)
  await expect(page.getByRole('tab', { name: /进行中/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: /已结束/ })).toBeVisible()
  await expect(page.getByRole('tab', { name: /全部/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
