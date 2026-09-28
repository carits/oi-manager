import { expect, test } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'

const organizationBase = '/org/org_school-default'
const switchableRoles: Array<{ account: AuthRole; expectedRole: string }> = [
  { account: 'principal', expectedRole: 'school_principal' },
  { account: 'teacher', expectedRole: 'teacher' },
  { account: 'campusStudent', expectedRole: 'student' },
]

const administratorRoles: Array<{ account: AuthRole; expectedRole: string; home: string }> = [
  { account: 'superAdmin', expectedRole: 'super_admin', home: '/admin' },
  { account: 'platformAdmin', expectedRole: 'platform_admin', home: '/platform-admin' },
]

const workHomes: Record<AuthRole, string> = {
  superAdmin: '/admin/schools',
  platformAdmin: '/platform-admin',
  principal: `${organizationBase}/overview`,
  teacher: `${organizationBase}/overview`,
  campusStudent: `${organizationBase}/overview`,
  personalStudent: '/personal',
}

const personalCoreRoutes = [
  '/personal',
  '/personal/teams',
  '/personal/problems',
  '/personal/contests',
  '/personal/problem-lists',
  '/personal/submissions',
  '/personal/rankings',
] as const

test.describe('all-role workspace switching @smoke', () => {
  for (const entry of switchableRoles) {
    test(`${entry.expectedRole} keeps its role while switching workspaces`, async ({ request }) => {
      const account = accounts[entry.account]
      const login = await request.post('/api/auth/login', {
        data: {
          username: account.username,
          password: account.password,
          workspaceMode: 'work',
        },
      })
      expect(login.status()).toBe(200)
      const workSession = (await login.json()).data
      expect(workSession.accountRole).toBe('user')
      const workMe = await request.get('/api/auth/me', {
        headers: { 'X-OI-Organization-ID': 'org_school-default' },
      })
      expect(workMe.status()).toBe(200)
      expect((await workMe.json()).data.organizationRole).toBe(entry.expectedRole)
      expect(workSession.workspaceMode).toBe('work')

      const personalSwitch = await request.post('/api/auth/switch-workspace', {
        data: { workspaceMode: 'personal' },
      })
      expect(personalSwitch.status()).toBe(200)
      const personalSession = (await personalSwitch.json()).data
      expect(personalSession.workspaceMode).toBe('personal')

      const me = await request.get('/api/auth/me')
      expect(me.status()).toBe(200)
      const personalUser = (await me.json()).data
      expect(personalUser.accountRole).toBe('user')
      expect(personalUser).not.toHaveProperty('organizationRole')
      expect(personalUser.workspaceMode).toBe('personal')

      const overview = await request.get('/api/me/overview')
      expect(overview.status()).toBe(200)
      const overviewBody = (await overview.json()).data
      expect(overviewBody.profile.username).toBe(account.username)
      expect(overviewBody.profile).not.toHaveProperty('name')
      expect(overviewBody.profile).not.toHaveProperty('schoolId')
      expect(overviewBody.profile).not.toHaveProperty('role')

      expect((await request.get('/api/stats/global')).status()).toBe(403)

      const workSwitch = await request.post('/api/auth/switch-workspace', {
        data: { workspaceMode: 'work' },
      })
      expect(workSwitch.status()).toBe(200)
      expect((await workSwitch.json()).data.workspaceMode).toBe('work')
    })
  }
})

test.describe('all-role workspace shell @smoke', () => {
  for (const entry of switchableRoles) {
    test(`${entry.expectedRole} enters the same personal shell`, async ({ browser }) => {
      const account = accounts[entry.account]
      const context = await browser.newContext({ storageState: account.storageState })
      const page = await context.newPage()
      await page.goto(workHomes[entry.account])

      const workspaceControl = page.getByRole('button', { name: '切换工作区' })
      await workspaceControl.click()
      await page.getByRole('region', { name: '切换工作区' }).getByRole('button', { name: /个人/ }).click()
      await page.waitForURL(/\/personal(?:\?.*)?$/)

      await expect(page.getByRole('navigation', { name: '个人主导航' })).toBeVisible()
      await expect(page.locator('[data-navigation-mode="expanded"]')).toBeVisible()
      await expect(page.getByText(account.username, { exact: true }).first()).toBeVisible()
      await expect(page.locator('main')).not.toContainText('E2E Principal')
      await expect(page.locator('main')).not.toContainText('E2E Teacher')
      await expect(page.locator('main')).not.toContainText('E2E School')

      for (const route of personalCoreRoutes) {
        await page.goto(route)
        await expect(page).toHaveURL(new RegExp(`${route.replaceAll('/', '\\/')}(?:\\?.*)?$`))
        await expect(page.getByRole('navigation', { name: '个人主导航' })).toBeVisible()
        await expect(page.locator('main h1').first()).toBeVisible()
        await expect(page.locator('main')).not.toContainText('服务器错误')
        await expect(page.locator('main')).not.toContainText('页面不存在')
      }

      await context.close()
    })
  }
})

test.describe('administrator workspace isolation @smoke', () => {
  for (const entry of administratorRoles) {
    test(`${entry.expectedRole} has only its administrator workspace`, async ({ browser, request }) => {
      const account = accounts[entry.account]
      const login = await request.post('/api/auth/login', {
        data: { username: account.username, password: account.password },
      })
      expect(login.status()).toBe(200)

      const personalSwitch = await request.post('/api/auth/switch-workspace', {
        data: { workspaceMode: 'personal' },
      })
      expect(personalSwitch.status()).toBe(403)

      const context = await browser.newContext({ storageState: account.storageState })
      const page = await context.newPage()
      await page.goto(entry.home)
      await expect(page.locator('button[aria-label^="切换工作区"]')).toHaveCount(0)

      await page.goto('/personal')
      await expect(page).toHaveURL(new RegExp(`${entry.home.replaceAll('/', '\\/')}(?:\\?.*)?$`))
      await context.close()
    })
  }
})

test.describe('unified sidebar navigation @smoke', () => {
  test('is expanded by default on desktop, keeps a usable rail, and remembers a manual choice', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/overview`)

    const navigation = page.getByRole('navigation', { name: '教师主导航' })
    await expect(navigation).toBeVisible()
    await expect(page.locator('[data-navigation-mode="expanded"]')).toBeVisible()
    await expect(page.getByRole('button', { name: '打开账号菜单' })).toBeVisible()

    await page.getByRole('link', { name: '成员与权限', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${organizationBase.replaceAll('/', '\\/')}\/management$`))
    await expect(navigation).toBeVisible()

    await page.reload()
    await expect(page.getByRole('navigation', { name: '教师主导航' })).toBeVisible()
    await page.getByRole('button', { name: '收起导航' }).first().click()
    await expect(page.getByRole('navigation', { name: '教师主导航' })).toBeVisible()
    await expect(page.locator('[data-navigation-mode="compact"]')).toBeVisible()
    await page.reload()
    await expect(page.locator('[data-navigation-mode="compact"]')).toBeVisible()
    await context.close()
  })
})

test.describe('personal workspace isolation', () => {
  test('a teacher personal team is invisible from the work workspace', async ({ request }) => {
    const account = accounts.teacher
    const login = await request.post('/api/auth/login', {
      data: {
        username: account.username,
        password: account.password,
        workspaceMode: 'work',
      },
    })
    expect(login.status()).toBe(200)

    await request.post('/api/auth/switch-workspace', { data: { workspaceMode: 'personal' } })
    const id = `e2e_teacher_personal_${Date.now()}`
    const created = await request.post('/api/teams', {
      data: { id, name: 'Teacher Personal Team', isPublic: false },
    })
    expect(created.status()).toBe(200)
    expect((await created.json()).data).not.toHaveProperty('schoolId')

    const personalTeams = await request.get('/api/teams?view=mine')
    expect((await personalTeams.json()).data.data.map((team: { id: string }) => team.id)).toContain(id)

    await request.post('/api/auth/switch-workspace', { data: { workspaceMode: 'work' } })
    const workTeams = await request.get('/api/teams?view=mine')
    expect((await workTeams.json()).data.data.map((team: { id: string }) => team.id)).not.toContain(id)
    expect((await request.get(`/api/teams/${id}`)).status()).toBe(403)

    await request.post('/api/auth/switch-workspace', { data: { workspaceMode: 'personal' } })
    expect((await request.delete(`/api/teams/${id}`)).status()).toBe(200)
  })

  test('a failed switch keeps the current workspace and page', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.route('**/api/auth/switch-workspace', route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'temporary failure' }),
    }))

    await page.goto(`${organizationBase}/overview`)
    const workspaceControl = page.getByRole('button', { name: '切换工作区' })
    await workspaceControl.click()
    await page.getByRole('region', { name: '切换工作区' }).getByRole('button', { name: /个人/ }).click()

    await expect(page).toHaveURL(new RegExp(`${organizationBase.replaceAll('/', '\\/')}\/overview$`))
    await context.close()
  })
})
