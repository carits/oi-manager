import { expect, test, type APIRequestContext } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'
import { assertAccessibleState } from '../support/page-audit'

const ids = loadFixtureIds()
const organizationId = `org_${ids.school}`
const organizationHeaders = { 'X-OI-Organization-ID': organizationId }

async function apiData(response: Awaited<ReturnType<APIRequestContext['get']>>) {
  const body = await response.json()
  expect(response.ok(), JSON.stringify(body)).toBe(true)
  return body.data
}

async function workspace(request: APIRequestContext, sessionId: string) {
  return apiData(await request.get(`/api/training-sessions/${sessionId}`))
}

async function createSession(request: APIRequestContext, title: string, sessionType: 'GENERAL' | 'OI' | 'ACM' = 'GENERAL') {
  return apiData(await request.post('/api/training-sessions', {
    data: {
      title,
      teamId: ids.team,
      participantTarget: 'team',
      sessionType,
      totalDurationSeconds: 20 * 60 * 60,
      startImmediately: true,
      problems: [{ problemId: ids.problem, alias: '热身题' }],
    },
  }))
}

test.describe('Training V3 hard cut @smoke', () => {
  test('A: 创建后直接进入单轮课堂，不暴露旧流程', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const coach = await context.newPage()
    await coach.goto(`/org/${organizationId}/training-sessions`)
    await coach.getByRole('button', { name: '布置训练' }).click()
    const dialog = coach.getByRole('dialog', { name: '创建训练' })
    await assertAccessibleState(coach)
    await expect(dialog.getByText('训练模板')).toHaveCount(0)
    await expect(dialog.getByText('必做')).toHaveCount(0)
    await expect(dialog.getByText('选做')).toHaveCount(0)
    await expect(dialog.getByText(/Stage|阶段|Hint/)).toHaveCount(0)
    await dialog.getByLabel('训练名称').fill('E2E V3 单轮课堂')
    const editor = dialog.getByTestId('problem-list-editor')
    await editor.getByRole('button', { name: '＋ 添加一道题目', exact: true }).click()
    await editor.getByLabel('第 1 题平台', { exact: true }).selectOption('carits')
    const resolved = coach.waitForResponse(response => new URL(response.url()).pathname === '/api/problem-selection/resolve')
    await editor.getByRole('textbox', { name: '第 1 题题号', exact: true }).fill('E2E-1000')
    await expect((await resolved).ok()).toBe(true)
    const request = coach.waitForRequest(value => value.method() === 'POST' && new URL(value.url()).pathname === '/api/training-sessions')
    await dialog.getByRole('button', { name: '创建并开始' }).click()
    expect((await request).postDataJSON()).toMatchObject({
      sessionType: 'GENERAL',
      startImmediately: true,
      totalDurationSeconds: 7200,
      problems: [{ problemId: ids.problem }],
    })
    await expect(coach).toHaveURL(/\/training-sessions\/[^/]+$/)
    await expect(coach.getByRole('button', { name: '题目调整' })).toBeVisible()
    await expect(coach.getByRole('button', { name: '聚焦题目' })).toBeVisible()
    await expect(coach.getByRole('button', { name: '调整分组' })).toBeVisible()
    await expect(coach.getByRole('button', { name: /下一步/ })).toBeVisible()
    await context.close()
  })

  test('B/C/F: 题目身份稳定，待开始轮次对学生隐藏，切轮后生效', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await createSession(coachContext.request, 'E2E V3 轮次切换')
    let coachWorkspace = await workspace(coachContext.request, session.id)
    expect(coachWorkspace.session.status).toBe('RUNNING')
    expect(coachWorkspace.session.Rounds).toHaveLength(1)
    const groupId = coachWorkspace.session.Groups[0].id
    const stableProblemId = coachWorkspace.session.Problems[0].id

    coachWorkspace = await apiData(await coachContext.request.put(`/api/training-sessions/${session.id}/assignments`, {
      data: { expectedRevision: coachWorkspace.session.statusRevision, groupId, problems: [] },
    }))
    coachWorkspace = await apiData(await coachContext.request.put(`/api/training-sessions/${session.id}/assignments`, {
      data: { expectedRevision: coachWorkspace.session.statusRevision, groupId, problems: [{ problemId: ids.problem, alias: '重新加入' }] },
    }))
    expect(coachWorkspace.session.Problems.find((item: any) => item.problemId === ids.problem)?.id).toBe(stableProblemId)

    coachWorkspace = await apiData(await coachContext.request.put(`/api/training-sessions/${session.id}/next-round`, {
      data: {
        expectedRevision: coachWorkspace.session.statusRevision,
        name: '第二轮',
        timeLimitSeconds: 1800,
        groups: [{ groupId, problems: [{ problemId: ids.secondProblem, alias: '进阶题' }] }],
      },
    }))
    expect(coachWorkspace.session.Rounds.some((round: any) => round.lifecycle === 'PENDING')).toBe(true)

    let studentWorkspace = await workspace(studentContext.request, session.id)
    expect(studentWorkspace.session.Rounds.some((round: any) => round.lifecycle === 'PENDING')).toBe(false)
    expect(studentWorkspace.session.Problems.some((item: any) => item.problemId === ids.secondProblem)).toBe(false)

    coachWorkspace = await apiData(await coachContext.request.post(`/api/training-sessions/${session.id}/rounds/advance`, {
      data: { expectedRevision: coachWorkspace.session.statusRevision },
    }))
    studentWorkspace = await workspace(studentContext.request, session.id)
    expect(studentWorkspace.effectiveProblems.map((item: any) => item.problemId)).toContain(ids.secondProblem)
    expect(studentWorkspace.effectiveProblems.map((item: any) => item.problemId)).not.toContain(ids.problem)

    await coachContext.close()
    await studentContext.close()
  })

  test('E: 聚焦仅接受当前有效题目', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await createSession(coachContext.request, 'E2E V3 聚焦')
    let current = await workspace(coachContext.request, session.id)
    const rejected = await coachContext.request.post(`/api/training-sessions/${session.id}/commands`, {
      data: {
        type: 'FOCUS_PROBLEM',
        expectedRevision: current.session.statusRevision,
        targetType: 'ALL',
        payload: { sessionProblemId: 'not-current' },
      },
    })
    expect(rejected.status()).toBe(422)

    current = await workspace(coachContext.request, session.id)
    const accepted = await coachContext.request.post(`/api/training-sessions/${session.id}/commands`, {
      data: {
        type: 'FOCUS_PROBLEM',
        expectedRevision: current.session.statusRevision,
        targetType: 'ALL',
        payload: { sessionProblemId: current.effectiveProblems[0].id },
      },
    })
    expect(accepted.ok()).toBe(true)
    await coachContext.close()
  })

  test('J: 390x844 课堂主操作和题目编辑无页面横向溢出', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders, viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`/org/${organizationId}/training-sessions/${ids.trainingSession}`)
    await expect(page.getByRole('heading', { name: 'E2E 教练训练' })).toBeVisible()
    await expect(page.getByRole('button', { name: '题目调整' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
    await context.close()
  })
})
