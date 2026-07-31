import { expect, test } from '@playwright/test'
import { bearer, loginAs } from '../fixtures/api'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'
import { assertPageHealth, waitForPageReady, watchPage } from '../support/page-audit'

const ids = loadFixtureIds()

function teamRows(body: any) {
  return body?.data?.data || []
}

test.describe('student mode API isolation @smoke', () => {
  test('campus and personal team resources stay isolated', async ({ request }) => {
    const campus = await loginAs(request, 'campusStudent')
    const personal = await loginAs(request, 'personalStudent')

    const campusMine = await request.get('/api/teams?view=mine&pageSize=100', {
      headers: bearer(campus),
    })
    expect(campusMine.status()).toBe(200)
    const campusTeams = teamRows(await campusMine.json())
    expect(campusTeams.map((team: any) => team.id)).toContain(ids.team)
    expect(campusTeams.map((team: any) => team.id)).not.toContain(ids.personalTeam)
    expect(campusTeams.every((team: any) => team.scope === 'campus')).toBe(true)

    const personalMine = await request.get('/api/teams?view=mine&pageSize=100', {
      headers: bearer(personal),
    })
    expect(personalMine.status()).toBe(200)
    const personalTeams = teamRows(await personalMine.json())
    expect(personalTeams.map((team: any) => team.id)).toContain(ids.personalTeam)
    expect(personalTeams.map((team: any) => team.id)).not.toContain(ids.team)
    expect(personalTeams.every((team: any) => team.scope === 'personal')).toBe(true)
    expect(personalTeams.every((team: any) => !('schoolId' in team))).toBe(true)

    const personalDetail = await request.get(`/api/teams/${ids.personalTeam}`, {
      headers: bearer(personal),
    })
    expect(personalDetail.status()).toBe(200)
    const personalTeam = (await personalDetail.json()).data
    expect(personalTeam.owner.name).toBe(accounts.personalStudent.username)
    expect(personalTeam.owner.name).not.toBe('E2E Personal Student')
    expect(personalTeam.school.id).toBe('personal')
    expect(personalTeam).not.toHaveProperty('schoolId')

    expect((await request.get(`/api/teams/${ids.personalTeam}`, {
      headers: bearer(campus),
    })).status()).toBe(403)
    expect((await request.get(`/api/teams/${ids.team}`, {
      headers: bearer(personal),
    })).status()).toBe(403)

    for (const path of [
      `/api/teams/${ids.personalTeam}/problem-lists`,
      `/api/teams/${ids.personalTeam}/trainings`,
      `/api/teams/${ids.personalTeam}/admins`,
      `/api/teams/${ids.personalTeam}/pending-invites`,
      `/api/teams/${ids.personalTeam}/join-requests`,
    ]) {
      expect((await request.get(path, { headers: bearer(personal) })).status()).toBe(200)
      expect((await request.get(path, { headers: bearer(campus) })).status()).toBe(403)
    }
  })

  test('campus and personal rankings expose separate identity contracts', async ({ request }) => {
    const campus = await loginAs(request, 'campusStudent')
    const personal = await loginAs(request, 'personalStudent')

    for (const endpoint of ['rating', 'solved']) {
      const response = await request.get(`/api/rankings/personal/${endpoint}?pageSize=100`, {
        headers: bearer(personal),
      })
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data.every((row: any) => row.username && !('name' in row) && !('schoolId' in row))).toBe(true)

      expect((await request.get(`/api/rankings/personal/${endpoint}`, {
        headers: bearer(campus),
      })).status()).toBe(403)
    }

    expect((await request.get(`/api/schools/${ids.school}/student-rankings`, {
      headers: bearer(campus),
    })).status()).toBe(200)
    expect((await request.get(`/api/schools/${ids.school}/student-rankings`, {
      headers: bearer(personal),
    })).status()).toBe(403)
  })
})

test.describe('personal student pages @smoke', () => {
  test.use({ storageState: accounts.personalStudent.storageState })

  test('core personal pages render without failed requests', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.personalStudent.storageState })
    for (const route of [
      '/student',
      '/student/team',
      `/student/team/${ids.personalTeam}`,
      '/student/rating',
      '/student/problems',
      '/student/problem-lists',
      '/student/contests',
      '/student/submissions',
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
    await page.goto('/student/team')
    await expect(page.getByRole('heading', { name: '团队管理' })).toBeVisible()
    await expect(page.getByText('E2E Personal Team')).toBeVisible()
    await expect(page.locator('main')).not.toContainText('E2E Training Team')

    await page.goto(`/student/team/${ids.personalTeam}`)
    await expect(page.getByText('E2E Personal Team')).toBeVisible()
    await expect(page.getByRole('link', {
      name: accounts.personalStudent.username,
      exact: true,
    })).toBeVisible()
    await expect(page.locator('main')).not.toContainText('E2E Personal Student')

    await page.goto('/student/rating')
    await expect(page.getByRole('heading', { name: '个人模式排名' })).toBeVisible()
    await expect(page.locator('main').getByText(accounts.personalStudent.username, {
      exact: true,
    })).toBeVisible()
    await expect(page.locator('main')).not.toContainText('E2E Personal Student')
  })

  test('mode switch replaces personal navigation and cached data', async ({ page }) => {
    await page.goto('/student/team')
    await expect(page.getByText('E2E Personal Team')).toBeVisible()

    await page.getByRole('button', { name: '个人模式 · 切换到校园' }).click()
    await page.waitForURL('/student')
    await expect(page.getByRole('button', { name: '校园模式 · 切换到个人' })).toBeVisible()

    await page.goto('/student/team')
    await expect(page.getByText('E2E Training Team')).toBeVisible()
    await expect(page.locator('main')).not.toContainText('E2E Personal Team')
  })
})
