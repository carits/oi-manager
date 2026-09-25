import { expect, test } from '@playwright/test'
import { sessionCookie, loginAs } from '../fixtures/api'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'
import { assertPageHealth, waitForPageReady, watchPage } from '../support/page-audit'

const ids = loadFixtureIds()
const organizationBase = `/org/org_${ids.school}`

function teamRows(body: any) {
  return body?.data?.data || []
}

test.describe('workspace isolation API isolation @smoke', () => {
  test('campus and personal team resources stay isolated', async ({ request }) => {
    const campus = await loginAs(request, 'campusStudent')
    const personal = await loginAs(request, 'personalStudent')
    const campusHeaders = { ...sessionCookie(campus), 'X-OI-Organization-ID': `org_${ids.school}` }

    const campusMine = await request.get('/api/teams?view=mine&pageSize=100', {
      headers: campusHeaders,
    })
    expect(campusMine.status()).toBe(200)
    const campusTeams = teamRows(await campusMine.json())
    expect(campusTeams.map((team: any) => team.id)).toContain(ids.team)
    expect(campusTeams.map((team: any) => team.id)).not.toContain(ids.personalTeam)
    expect(campusTeams.every((team: any) => team.scope === 'campus')).toBe(true)

    const personalMine = await request.get('/api/teams?view=mine&pageSize=100', {
      headers: sessionCookie(personal),
    })
    expect(personalMine.status()).toBe(200)
    const personalTeams = teamRows(await personalMine.json())
    expect(personalTeams.map((team: any) => team.id)).toContain(ids.personalTeam)
    expect(personalTeams.map((team: any) => team.id)).not.toContain(ids.team)
    expect(personalTeams.every((team: any) => team.scope === 'personal')).toBe(true)
    expect(personalTeams.every((team: any) => !('schoolId' in team))).toBe(true)

    const personalDetail = await request.get(`/api/teams/${ids.personalTeam}`, {
      headers: sessionCookie(personal),
    })
    expect(personalDetail.status()).toBe(200)
    const personalTeam = (await personalDetail.json()).data
    expect(personalTeam.owner.name).toBe(accounts.personalStudent.username)
    expect(personalTeam.owner.name).not.toBe('E2E Personal Student')
    expect(personalTeam).not.toHaveProperty('school')
    expect(personalTeam).not.toHaveProperty('schoolId')

    expect((await request.get(`/api/teams/${ids.personalTeam}`, {
      headers: campusHeaders,
    })).status()).toBe(403)
    expect((await request.get(`/api/teams/${ids.team}`, {
      headers: sessionCookie(personal),
    })).status()).toBe(403)

    for (const path of [
      `/api/teams/${ids.personalTeam}/problem-lists`,
      `/api/teams/${ids.personalTeam}/contests`,
      `/api/teams/${ids.personalTeam}/admins`,
      `/api/teams/${ids.personalTeam}/pending-invites`,
      `/api/teams/${ids.personalTeam}/join-requests`,
    ]) {
      expect((await request.get(path, { headers: sessionCookie(personal) })).status()).toBe(200)
      expect((await request.get(path, { headers: campusHeaders })).status()).toBe(403)
    }
  })

  test('campus and personal rankings expose separate identity contracts', async ({ request }) => {
    const campus = await loginAs(request, 'campusStudent')
    const personal = await loginAs(request, 'personalStudent')
    const campusHeaders = { ...sessionCookie(campus), 'X-OI-Organization-ID': `org_${ids.school}` }

    for (const endpoint of ['rating', 'solved']) {
      const response = await request.get(`/api/rankings/personal/${endpoint}?pageSize=100`, {
        headers: sessionCookie(personal),
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data.every((row: any) => row.username && !('name' in row) && !('schoolId' in row))).toBe(true)

      expect((await request.get(`/api/rankings/personal/${endpoint}`, {
        headers: campusHeaders,
      })).status()).toBe(403)
    }

    expect((await request.get(`/api/rankings/organizations/org_${ids.school}/rating`, {
      headers: campusHeaders,
    })).status()).toBe(200)
    expect((await request.get(`/api/rankings/organizations/org_${ids.school}/rating`, {
      headers: sessionCookie(personal),
    })).status()).toBe(403)
  })
})

test.describe('personal workspace pages @smoke', () => {
  test.use({ storageState: accounts.personalStudent.storageState })

  test('core personal pages render without failed requests', async ({ browser }) => {
    test.setTimeout(120_000)
    const context = await browser.newContext({ storageState: accounts.personalStudent.storageState })
    for (const route of [
      '/personal',
      '/personal/teams',
      `/personal/teams/${ids.personalTeam}`,
      '/personal/rankings',
      '/personal/problems',
      '/personal/problem-lists',
      '/personal/contests',
      '/personal/submissions',
    ]) {
      const page = await context.newPage()
      const audit = watchPage(page)
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      await waitForPageReady(page)
      await assertPageHealth(page, audit)
      await page.close()
    }
    await context.close()
  })

  test('team and ranking pages show personal data and usernames', async ({ page }) => {
    await page.goto('/personal/teams')
    await expect(page.getByRole('heading', { name: '团队' })).toBeVisible()
    await expect(page.getByText('E2E Personal Team')).toBeVisible()
    await expect(page.locator('main')).not.toContainText('E2E Training Team')

    await page.goto(`/personal/teams/${ids.personalTeam}`)
    await expect(page.getByText('E2E Personal Team')).toBeVisible()
    await expect(page.getByText(accounts.personalStudent.username, { exact: true }).first()).toBeVisible()
    await expect(page.locator('main')).not.toContainText('E2E Personal Student')

    await page.goto('/personal/rankings')
    await expect(page.getByRole('heading', { name: '个人排行榜' })).toBeVisible()
    await expect(page.getByRole('cell', { name: new RegExp(accounts.personalStudent.username) })).toBeVisible()
    await expect(page.locator('main')).not.toContainText('E2E Personal Student')
  })

  test('mode switch replaces personal navigation and cached data', async ({ page }) => {
    await page.goto('/personal/teams')
    await expect(page.getByText('E2E Personal Team')).toBeVisible()

    const workspaceControl = page.getByRole('button', { name: '切换身份' })
    await workspaceControl.click()
    await page.getByRole('menu', { name: '切换身份' }).getByRole('menuitem', { name: /^E2E School学生/ }).click()
    await page.waitForURL(new RegExp(`${organizationBase.replaceAll('/', '\\/')}\/(?:overview|teams|homeworks|contests|problem-lists|rankings)$`))

    await page.goto(`${organizationBase}/teams`)
    await expect(page.getByText('E2E Training Team')).toBeVisible()
    await expect(page.locator('main')).not.toContainText('E2E Personal Team')
  })
})
