import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()
const organizationBase = `/org/org_${ids.school}`
const secondaryOrganizationBase = '/org/org_school-secondary'

test.describe('login and permission boundaries @smoke @compact', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('root opens the login form directly', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator('form')).toBeVisible()
  })

  test('unified login form has no role selector', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('button', { name: '学生', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('用户名')).toBeVisible()
    await expect(page.getByLabel('密码')).toBeVisible()
  })

  test('invalid credentials show a user-facing error', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('用户名').fill('student1')
    await page.getByLabel('密码').fill('incorrect-password')
    await page.getByRole('button', { name: '登录' }).click()
    await expect(page.getByText(/用户名或密码错误|登录失败/)).toBeVisible()
  })

  test('anonymous protected route redirects to unified login', async ({ page }) => {
    await page.goto(`${organizationBase}/teams`)
    await expect(page).toHaveURL(/\/login\?next=%2Forg%2Forg_school-default%2Fteams/)
  })
})

test.describe('authenticated permission matrix @smoke', () => {
  test('student cannot enter teacher or admin areas', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/management`)
    await expect(page).toHaveURL(new RegExp(`${organizationBase.replaceAll('/', '\\/')}\/management$`))
    await expect(page.getByRole('heading', { name: '无法访问该页面' })).toBeVisible()
    await expect(page.getByText(/仅教师或学校负责人可以使用/)).toBeVisible()
    await page.goto('/admin/schools')
    await expect(page).toHaveURL(/\/identity$/)
    await context.close()
  })

  test('student can open the campus submission history linked from the overview', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/submissions`)
    await expect(page).toHaveURL(new RegExp(`${organizationBase.replaceAll('/', '\\/')}\/submissions$`))
    await expect(page.getByRole('heading', { name: '评测记录' })).toBeVisible()
    await expect(page.getByLabel('用户名')).toHaveCount(0)
    const submissionFilters = page.getByRole('search', { name: '评测记录筛选' })
    await expect(submissionFilters).toBeVisible()
    await expect(submissionFilters.getByLabel('平台')).toHaveValue('')
    await expect(submissionFilters.getByLabel('题号')).toBeVisible()
    await expect(submissionFilters.getByLabel('评测结果')).toHaveValue('')
    await expect(submissionFilters.getByLabel('评测结果').locator('option').first()).toHaveText('全部结果')
    await expect(submissionFilters.getByLabel('语言').locator('option').first()).toHaveText('全部语言')
    await expect(page.locator(`a[href^="${organizationBase}/problems/"]`)).toHaveCount(0)
    await context.close()
  })

  test('teacher cannot enter administrator areas', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.goto('/platform-admin')
    await expect(page).toHaveURL(/\/identity$/)
    await context.close()
  })

  test('teacher keeps the correct SSR identity across personal and two organization contexts', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()

    await page.goto('/personal')
    await expect(page).toHaveURL(/\/personal$/)

    await page.goto(`${organizationBase}/overview`)
    await expect(page).toHaveURL(new RegExp(`${organizationBase.replaceAll('/', '\\/')}\/overview$`))
    await expect.poll(async () => page.evaluate(async () => {
      const response = await fetch('/api/auth/me', { headers: { 'X-OI-Organization-ID': 'org_school-default' } })
      const payload = await response.json()
      return payload.data?.organizationId
    })).toBe('org_school-default')

    await page.goto(`${secondaryOrganizationBase}/overview`)
    await expect(page).toHaveURL(new RegExp(`${secondaryOrganizationBase.replaceAll('/', '\\/')}\/overview$`))
    await expect.poll(async () => page.evaluate(async () => {
      const response = await fetch('/api/auth/me', { headers: { 'X-OI-Organization-ID': 'org_school-secondary' } })
      const payload = await response.json()
      return payload.data?.organizationId
    })).toBe('org_school-secondary')

    await page.goto('/personal')
    await expect(page).toHaveURL(/\/personal$/)
    await context.close()
  })

  test('invalid organization context returns to identity without clearing the account session', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.goto('/org/not-a-real-organization/overview')
    await expect(page).toHaveURL(/\/identity\?organizationUnavailable=1/)
    await expect(page.getByText('选择身份')).toBeVisible()
    await context.close()
  })

  test('teacher with contest management capability returns from statement selection', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/contests/${ids.contest}/statements`)
    await expect(page).toHaveURL(new RegExp(`${organizationBase.replaceAll('/', '\\/')}\/contests\/${ids.contest}$`))
    await expect(page.getByRole('heading', { name: 'E2E Finished Contest' })).toBeVisible()
    await expect(page.getByText('无权管理活动题面')).toHaveCount(0)
    await context.close()
  })

  test('principal can enter organization management', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.principal.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/management`)
    await expect(page).toHaveURL(new RegExp(`${organizationBase.replaceAll('/', '\\/')}\/management$`))
    await expect(page.locator('body')).not.toContainText('无权限')
    await context.close()
  })

  test('super admin cannot enter platform administration', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.superAdmin.storageState })
    const page = await context.newPage()
    await page.goto('/platform-admin/problems')
    await expect(page).toHaveURL(/\/admin$/)
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
    await expect(page).toHaveURL(/\/platform-admin$/)
    await context.close()
  })
})
