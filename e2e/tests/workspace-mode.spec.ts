import { expect, test } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'

const roles: Array<{ account: AuthRole; expectedRole: string }> = [
  { account: 'superAdmin', expectedRole: 'super_admin' },
  { account: 'platformAdmin', expectedRole: 'platform_admin' },
  { account: 'principal', expectedRole: 'school_principal' },
  { account: 'teacher', expectedRole: 'teacher' },
  { account: 'campusStudent', expectedRole: 'student' },
]

const workHomes: Record<AuthRole, string> = {
  superAdmin: '/admin/schools',
  platformAdmin: '/platform-admin',
  principal: '/teacher',
  teacher: '/teacher',
  campusStudent: '/student',
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
  for (const entry of roles) {
    test(`${entry.expectedRole} keeps its role while switching workspaces`, async ({ request }) => {
      const account = accounts[entry.account]
      const login = await request.post('/api/auth/login', {
        data: {
          username: account.username,
          password: account.password,
          role: account.loginRole,
          workspaceMode: 'work',
        },
      })
      expect(login.status()).toBe(200)
      const workSession = (await login.json()).data
      expect(workSession.role).toBe(entry.expectedRole)
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
      expect(personalUser.role).toBe(entry.expectedRole)
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
  for (const entry of roles) {
    test(`${entry.expectedRole} enters the same personal shell`, async ({ browser }) => {
      const account = accounts[entry.account]
      const context = await browser.newContext({ storageState: account.storageState })
      const page = await context.newPage()
      await page.goto(workHomes[entry.account])

      const workspaceControl = page.getByRole('group', { name: '工作区' })
      await workspaceControl.getByRole('button', { name: '个人', exact: true }).click()
      await page.waitForURL(/\/personal(?:\?.*)?$/)

      await expect(page.getByRole('navigation', { name: '个人工作区导航' })).toBeVisible()
      await expect(page.getByText('个人工作区', { exact: true })).toBeVisible()
      await expect(page.getByText(account.username, { exact: true }).first()).toBeVisible()
      await expect(page.locator('main')).not.toContainText('E2E Principal')
      await expect(page.locator('main')).not.toContainText('E2E Teacher')
      await expect(page.locator('main')).not.toContainText('E2E School')

      for (const route of personalCoreRoutes) {
        await page.goto(route)
        await expect(page).toHaveURL(new RegExp(`${route.replaceAll('/', '\\/')}(?:\\?.*)?$`))
        await expect(page.getByRole('navigation', { name: '个人工作区导航' })).toBeVisible()
        await expect(page.locator('main h1').first()).toBeVisible()
        await expect(page.locator('main')).not.toContainText('服务器错误')
        await expect(page.locator('main')).not.toContainText('页面不存在')
      }

      await context.close()
    })
  }
})

test.describe('personal workspace isolation', () => {
  test('a teacher personal team is invisible from the work workspace', async ({ request }) => {
    const account = accounts.teacher
    const login = await request.post('/api/auth/login', {
      data: {
        username: account.username,
        password: account.password,
        role: account.loginRole,
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

    await page.goto('/teacher')
    const workspaceControl = page.getByRole('group', { name: '工作区' })
    await workspaceControl.getByRole('button', { name: '个人', exact: true }).click()

    await expect(page).toHaveURL(/\/teacher$/)
    await expect(workspaceControl.getByRole('button', { name: '校园', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('模式切换失败，请重试')).toBeVisible()
    await context.close()
  })
})
