import { expect, test } from '@playwright/test'
import { bearer, loginAs } from '../fixtures/api'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'
import { installExternalMocks } from '../fixtures/external-mocks'

const ids = loadFixtureIds()

test.describe('core role workflows @smoke', () => {
  test('super admin can inspect a school and its member tabs', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.superAdmin.storageState })
    const page = await context.newPage()

    await page.goto(`/admin/schools/${ids.school}`)
    await expect(page.getByRole('heading', { level: 2 })).toBeVisible()
    await expect(page.getByText('E2E School')).toBeVisible()
    await page.getByRole('button', { name: /教师/ }).click()
    await expect(page.getByText('E2E Principal')).toBeVisible()
    await page.getByRole('button', { name: /学生/ }).click()
    await expect(page.getByText('E2E Campus Student')).toBeVisible()

    await context.close()
  })

  test('platform admin can inspect seeded problems and submissions', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.platformAdmin.storageState })
    const page = await context.newPage()
    await installExternalMocks(page)

    await page.goto(`/platform-admin/problems/${ids.problem}`)
    await expect(page.locator('body')).toContainText('E2E A Plus B')
    await page.goto(`/platform-admin/submissions/${ids.submission}`)
    await expect(page.locator('body')).toContainText(/accepted|通过/i)

    await context.close()
  })

  test('teacher can inspect the problem-list, homework, contest and ranking', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.principal.storageState })
    const page = await context.newPage()

    await page.goto(`/teacher/problem-lists/${ids.problemList}`)
    await expect(page.locator('body')).toContainText('E2E Basic Problem List')
    await expect(page.getByRole('button', { name: /发布.*作业/ })).toBeVisible()

    await page.goto(`/teacher/teams/${ids.team}/homeworks/${ids.homework}`)
    await expect(page.locator('body')).toContainText('E2E Active Homework')
    await page.goto(`/teacher/teams/${ids.team}/contests/${ids.contest}`)
    await expect(page.locator('body')).toContainText('E2E Finished Contest')
    await page.getByRole('tab', { name: /排名/ }).click()
    await expect(page.locator('body')).toContainText('E2E Campus Student')

    await context.close()
  })

  test('regular teacher can use inherited team and student routes', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()

    await page.goto(`/teacher/teams/${ids.team}`)
    await expect(page.locator('body')).toContainText('E2E Training Team')
    await page.goto('/teacher/students')
    await expect(page.locator('body')).toContainText('E2E Personal Student')

    await context.close()
  })

  test('student can browse team work and the accepted submission', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const page = await context.newPage()

    await page.goto(`/student/team/${ids.team}`)
    await expect(page.locator('body')).toContainText('E2E Training Team')
    await page.goto(`/student/homeworks/${ids.homework}`)
    await expect(page.locator('body')).toContainText('E2E Active Homework')
    await page.goto(`/student/submissions/${ids.submission}`)
    await expect(page.locator('body')).toContainText(/accepted|通过/i)

    await context.close()
  })
})

test.describe('published work and ranking contracts', () => {
  test('teacher publishes a problem list as homework visible to the student', async ({ request }) => {
    const teacher = await loginAs(request, 'principal')
    const student = await loginAs(request, 'campusStudent')
    const now = Date.now()
    const title = `E2E Published Homework ${now}`
    const publishResponse = await request.post(
      `/api/problem-lists/${ids.problemList}/publish-homework`,
      {
        headers: bearer(teacher),
        data: {
          teamId: ids.team,
          title,
          startTime: new Date(now - 60_000).toISOString(),
          endTime: new Date(now + 3_600_000).toISOString(),
          format: 'ioi',
        },
      },
    )
    expect(publishResponse.status()).toBe(200)
    const published = await publishResponse.json()
    expect(published.success).toBe(true)

    const listResponse = await request.get('/api/students/my-homeworks', {
      headers: bearer(student),
    })
    expect(listResponse.status()).toBe(200)
    const list = await listResponse.json()
    expect(JSON.stringify(list.data)).toContain(title)
  })

  test('finished contest creates a makeup homework with ranking intact', async ({ request }) => {
    const teacher = await loginAs(request, 'principal')
    const response = await request.post(
      `/api/trainings/${ids.contest}/create-makeup-homework`,
      {
        headers: bearer(teacher),
        data: {
          title: `E2E Makeup ${Date.now()}`,
          startTime: new Date(Date.now() - 60_000).toISOString(),
          endTime: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
    )
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(String(body.data.sourceTrainingId)).toBe(ids.contest)

    const rankingResponse = await request.get(`/api/trainings/${ids.contest}/ranking`, {
      headers: bearer(teacher),
    })
    expect(rankingResponse.status()).toBe(200)
    const ranking = await rankingResponse.json()
    expect(ranking.success).toBe(true)
    expect(Array.isArray(ranking.data.ranking)).toBe(true)
  })
})
