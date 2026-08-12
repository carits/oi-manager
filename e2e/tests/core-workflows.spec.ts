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
    await expect(page.getByText('首 A', { exact: true })).toHaveCount(0)

    const firstAcceptedCells = page.locator('td[data-result="first-accepted"]')
    await expect(firstAcceptedCells).toHaveCount(2)
    await expect(firstAcceptedCells.first()).toHaveText(/^\d+\/\d+$/)
    await expect(firstAcceptedCells.first()).toHaveAttribute('title', /首个通过.*第 \d+ 次提交.*第 \d+ 分钟通过/)
    await expect(firstAcceptedCells.first()).toHaveCSS('background-color', 'rgb(47, 125, 50)')
    await firstAcceptedCells.first().hover()
    await expect(firstAcceptedCells.first()).toHaveCSS('background-color', 'rgb(47, 125, 50)')

    const acceptedCell = page.locator('td[data-result="accepted"]').first()
    await expect(acceptedCell).toHaveText('2/50')
    await expect(acceptedCell).toHaveCSS('background-color', 'rgb(232, 247, 233)')

    const failedCell = page.locator('td[data-result="failed"]').first()
    await expect(failedCell).toHaveText('-2')
    await expect(failedCell).toHaveCSS('background-color', 'rgb(251, 228, 228)')
    await expect(page.locator('td[data-result="unsubmitted"]').first()).toHaveText('')

    const participantColumnWidth = await page.getByRole('columnheader', { name: '参赛者' })
      .evaluate(cell => cell.getBoundingClientRect().width)
    expect(participantColumnWidth).toBeGreaterThanOrEqual(271)
    expect(participantColumnWidth).toBeLessThanOrEqual(273)

    const problemColumnWidths = await page.locator('th[data-problem-column="true"]').evaluateAll(
      cells => cells.map(cell => cell.getBoundingClientRect().width),
    )
    expect(Math.min(...problemColumnWidths)).toBeGreaterThanOrEqual(239)
    expect(Math.max(...problemColumnWidths)).toBeLessThanOrEqual(241)

    const tableMetrics = await page.getByRole('table', { name: '比赛排名' }).evaluate(element => {
      const table = element.getBoundingClientRect()
      const viewportWidth = element.parentElement?.getBoundingClientRect().width ?? 0
      return {
        tableWidth: table.width,
        leftSpace: table.left - (element.parentElement?.getBoundingClientRect().left ?? 0),
        rightSpace: (element.parentElement?.getBoundingClientRect().right ?? 0) - table.right,
        viewportWidth,
      }
    })
    expect(tableMetrics.tableWidth).toBe(1200)
    expect(tableMetrics.leftSpace).toBeLessThanOrEqual(1)
    expect(tableMetrics.rightSpace).toBeGreaterThan(0)
    expect(tableMetrics.viewportWidth).toBeGreaterThan(tableMetrics.tableWidth)

    await context.close()

    const mobileContext = await browser.newContext({
      storageState: accounts.campusStudent.storageState,
      viewport: { width: 390, height: 844 },
    })
    const mobilePage = await mobileContext.newPage()
    await mobilePage.goto(`/student/team/${ids.team}/contests/${ids.contest}?tab=ranking`)
    await expect(mobilePage.getByRole('table', { name: '比赛排名' })).toBeVisible()
    const currentUserRow = mobilePage.locator('tbody tr').filter({ hasText: 'E2E Campus Student' })
    await expect(currentUserRow).toBeVisible()
    const currentFirstAcceptedCell = currentUserRow.locator('td[data-result="first-accepted"]')
    await expect(currentFirstAcceptedCell).toHaveCSS('background-color', 'rgb(47, 125, 50)')
    await currentUserRow.hover()
    await expect(currentFirstAcceptedCell).toHaveCSS('background-color', 'rgb(47, 125, 50)')
    const scrollMetrics = await mobilePage.getByTestId('training-ranking-scroll').evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      rankWidth: element.querySelector('th:nth-child(1)')?.getBoundingClientRect().width ?? 0,
      participantWidth: element.querySelector('th:nth-child(2)')?.getBoundingClientRect().width ?? 0,
    }))
    expect(scrollMetrics.scrollWidth).toBeGreaterThan(scrollMetrics.clientWidth)
    expect(scrollMetrics.rankWidth).toBe(44)
    expect(scrollMetrics.participantWidth).toBe(176)
    expect(scrollMetrics.clientWidth - scrollMetrics.rankWidth - scrollMetrics.participantWidth)
      .toBeGreaterThanOrEqual(88)
    const stickyMetrics = await mobilePage.getByTestId('training-ranking-scroll').evaluate(element => {
      element.scrollLeft = 160
      const containerLeft = element.getBoundingClientRect().left
      const rankHeader = element.querySelector('th:nth-child(1)')?.getBoundingClientRect()
      const participantHeader = element.querySelector('th:nth-child(2)')?.getBoundingClientRect()
      return {
        containerLeft,
        rankLeft: rankHeader?.left ?? 0,
        participantLeft: participantHeader?.left ?? 0,
      }
    })
    expect(Math.abs(stickyMetrics.rankLeft - stickyMetrics.containerLeft)).toBeLessThanOrEqual(1)
    expect(Math.abs(stickyMetrics.participantLeft - stickyMetrics.containerLeft - 44)).toBeLessThanOrEqual(1)
    const pageHasHorizontalOverflow = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    )
    expect(pageHasHorizontalOverflow).toBe(false)
    await mobileContext.close()
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

  test('OI and IOI rankings use distinct compact score presentations', async ({ browser }) => {
    const scoreRanking = {
      problems: [
        { id: 'score-a', alias: 'A', orderIndex: 0, points: 100 },
        { id: 'score-b', alias: 'B', orderIndex: 1, points: 100 },
        { id: 'score-c', alias: 'C', orderIndex: 2, points: 100 },
      ],
      ranking: [
        {
          userId: ids.users.campusStudent,
          userType: 'student',
          name: 'E2E Campus Student',
          username: 'student1',
          avatar: null,
          totalScore: 150,
          problems: {
            'score-a': { score: 100 },
            'score-b': { score: 50 },
            'score-c': { score: 0 },
          },
        },
      ],
    }

    for (const format of ['oi', 'ioi'] as const) {
      const context = await browser.newContext({ storageState: accounts.principal.storageState })
      const page = await context.newPage()
      await page.route(`**/api/trainings/${ids.contest}/ranking`, route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { format, ...scoreRanking } }),
      }))
      await page.goto(`/teacher/teams/${ids.team}/contests/${ids.contest}?tab=ranking`)

      const table = page.getByRole('table', { name: '比赛排名' })
      await expect(table).toHaveAttribute('data-ranking-format', format)
      await expect(page.getByRole('columnheader', { name: /A.*100 分/ })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: '参赛者' })).toHaveCSS('width', '272px')

      const widths = await page.locator('th[data-problem-column="true"]').evaluateAll(
        cells => cells.map(cell => cell.getBoundingClientRect().width),
      )
      expect(Math.min(...widths)).toBeGreaterThanOrEqual(260)
      expect(Math.max(...widths)).toBeLessThanOrEqual(263)
      await expect(table).toHaveCSS('width', '1200px')

      const full = page.locator('td[data-score-state="full"]')
      const partial = page.locator('td[data-score-state="partial"]')
      const zero = page.locator('td[data-score-state="zero"]')
      if (format === 'oi') {
        await expect(full).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
        await expect(partial).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      } else {
        await expect(full).toHaveCSS('background-color', 'rgb(232, 247, 233)')
        await expect(partial).not.toHaveCSS('background-color', 'rgb(255, 255, 255)')
      }
      await expect(zero).toHaveCSS('color', 'rgb(148, 163, 184)')

      await context.close()
    }
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
