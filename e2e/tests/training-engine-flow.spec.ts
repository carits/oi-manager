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
    const groupingButton = coach.getByRole('button', { name: '调整分组' })
    await expect(groupingButton).toBeVisible()
    await expect(coach.getByRole('button', { name: '下一步', exact: true })).toBeVisible()
    await groupingButton.click()
    const groupingDialog = coach.getByRole('dialog', { name: '调整分组' })
    await groupingDialog.locator('input[type="checkbox"]').first().check()
    await groupingDialog.getByLabel('调整到').selectOption('__new_group__')
    await groupingDialog.getByLabel('新分组名称').fill('课堂新分组')
    await groupingDialog.getByRole('button', { name: '创建并调整' }).click()
    await expect(coach.getByText('2 个分组', { exact: true })).toBeVisible()
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

    coachWorkspace = await apiData(await coachContext.request.put('/api/training-sessions/' + session.id + '/next-round', {
      data: {
        expectedRevision: coachWorkspace.session.statusRevision,
        name: '第二轮（已修改）',
        timeLimitSeconds: 2400,
        groups: [{ groupId, problems: [{ problemId: ids.secondProblem, alias: '修改后的进阶题' }] }],
      },
    }))
    expect(coachWorkspace.session.Rounds.filter((round: any) => round.lifecycle === 'PENDING')).toHaveLength(1)
    expect(coachWorkspace.session.Rounds.find((round: any) => round.lifecycle === 'PENDING')?.name).toBe('第二轮（已修改）')

    coachWorkspace = await apiData(await coachContext.request.delete('/api/training-sessions/' + session.id + '/next-round', {
      data: { expectedRevision: coachWorkspace.session.statusRevision },
    }))
    expect(coachWorkspace.session.Rounds.some((round: any) => round.lifecycle === 'PENDING')).toBe(false)

    coachWorkspace = await apiData(await coachContext.request.put('/api/training-sessions/' + session.id + '/next-round', {
      data: {
        expectedRevision: coachWorkspace.session.statusRevision,
        name: '第二轮',
        timeLimitSeconds: 1800,
        groups: [{ groupId, problems: [{ problemId: ids.secondProblem, alias: '进阶题' }] }],
      },
    }))

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

  test('D/G: 分组题集和排名相互隔离，学生不能查看其他组', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const campusContext = await browser.newContext({ storageState: accounts.campusStudent.storageState, extraHTTPHeaders: organizationHeaders })
    const personalContext = await browser.newContext({ storageState: accounts.personalStudent.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await apiData(await coachContext.request.post('/api/training-sessions', {
      data: {
        title: 'E2E V3 分组排名',
        organizationId,
        participantTarget: 'custom_students',
        participantUserIds: [ids.users.campusStudent, ids.users.personalStudent],
        sessionType: 'OI',
        totalDurationSeconds: 20 * 60 * 60,
        startImmediately: true,
        problems: [{ problemId: ids.problem }, { problemId: ids.secondProblem }],
        grouping: {
          groups: [
            { name: '基础组', participantIds: [ids.users.campusStudent], problemIds: [ids.problem] },
            { name: '进阶组', participantIds: [ids.users.personalStudent], problemIds: [ids.problem, ids.secondProblem] },
          ],
        },
      },
    }))
    let coachWorkspace = await workspace(coachContext.request, session.id)
    const basicGroup = coachWorkspace.session.Groups.find((group: any) => group.name === '基础组')
    const advancedGroup = coachWorkspace.session.Groups.find((group: any) => group.name === '进阶组')
    expect(basicGroup).toBeTruthy()
    expect(advancedGroup).toBeTruthy()

    const basicRanking = await apiData(await coachContext.request.get(`/api/training-sessions/${session.id}/peer-progress?groupId=${basicGroup.id}`))
    const advancedRanking = await apiData(await coachContext.request.get(`/api/training-sessions/${session.id}/peer-progress?groupId=${advancedGroup.id}`))
    expect(basicRanking).toMatchObject({ scope: 'group', groupId: basicGroup.id })
    expect(basicRanking.entries.map((entry: any) => entry.user.id)).toEqual([ids.users.campusStudent])
    expect(basicRanking.entries[0].total).toBe(1)
    expect(advancedRanking).toMatchObject({ scope: 'group', groupId: advancedGroup.id })
    expect(advancedRanking.entries.map((entry: any) => entry.user.id)).toEqual([ids.users.personalStudent])
    expect(advancedRanking.entries[0].total).toBe(2)

    const forbidden = await campusContext.request.get(`/api/training-sessions/${session.id}/peer-progress?groupId=${advancedGroup.id}`)
    expect(forbidden.status()).toBe(403)
    const ownRanking = await apiData(await personalContext.request.get(`/api/training-sessions/${session.id}/peer-progress`))
    expect(ownRanking.groupId).toBe(advancedGroup.id)
    expect(ownRanking.entries.map((entry: any) => entry.user.id)).toEqual([ids.users.personalStudent])

    coachWorkspace = await apiData(await coachContext.request.put(`/api/training-sessions/${session.id}/next-round`, {
      data: {
        expectedRevision: coachWorkspace.session.statusRevision,
        name: '第二轮',
        groups: [
          { groupId: basicGroup.id, problems: [{ problemId: ids.problem }] },
          { groupId: advancedGroup.id, problems: [{ problemId: ids.secondProblem }] },
        ],
      },
    }))
    coachWorkspace = await apiData(await coachContext.request.put(`/api/training-sessions/${session.id}/grouping`, {
      data: {
        expectedRevision: coachWorkspace.session.statusRevision,
        groups: [
          { id: basicGroup.id, name: '基础组', participantIds: [basicGroup.Participants[0].id] },
          { id: advancedGroup.id, name: '进阶组', participantIds: [] },
          {
            clientKey: 'sprint-group',
            name: '冲刺组',
            sourceGroupId: advancedGroup.id,
            participantIds: [advancedGroup.Participants[0].id],
          },
        ],
      },
    }))
    const sprintGroup = coachWorkspace.session.Groups.find((group: any) => group.name === '冲刺组')
    const runningRound = coachWorkspace.session.Rounds.find((round: any) => round.lifecycle === 'RUNNING')
    const pendingRound = coachWorkspace.session.Rounds.find((round: any) => round.lifecycle === 'PENDING')
    const assignedProblemIds = (round: any) => round.Assignments
      .filter((assignment: any) => assignment.groupId === sprintGroup.id)
      .map((assignment: any) => assignment.SessionProblem.problemId)
    expect(sprintGroup).toBeTruthy()
    expect(assignedProblemIds(runningRound)).toEqual([ids.problem, ids.secondProblem])
    expect(assignedProblemIds(pendingRound)).toEqual([ids.secondProblem])
    await coachContext.close()
    await campusContext.close()
    await personalContext.close()
  })

  test('H: 相同 revision 的并发题目调整只能成功一次', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await createSession(context.request, 'E2E V3 并发写入')
    const current = await workspace(context.request, session.id)
    const groupId = current.session.Groups[0].id
    const responses = await Promise.all([
      context.request.put(`/api/training-sessions/${session.id}/assignments`, {
        data: { expectedRevision: current.session.statusRevision, groupId, problems: [{ problemId: ids.problem }] },
      }),
      context.request.put(`/api/training-sessions/${session.id}/assignments`, {
        data: { expectedRevision: current.session.statusRevision, groupId, problems: [{ problemId: ids.secondProblem }] },
      }),
    ])
    expect(responses.map(response => response.status()).sort()).toEqual([200, 409])
    const updated = await workspace(context.request, session.id)
    expect(updated.session.statusRevision).toBe(current.session.statusRevision + 1)
    expect(updated.effectiveProblems).toHaveLength(1)
    await context.close()
  })

  test('I: SSE 在轮询前把题目调整推送到学生页面', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await createSession(coachContext.request, 'E2E V3 实时题目调整')
    const student = await studentContext.newPage()
    await student.goto(`/org/${organizationId}/training-sessions/${session.id}`)
    await expect(student.getByText('热身题', { exact: true })).toBeVisible()

    const current = await workspace(coachContext.request, session.id)
    await apiData(await coachContext.request.put(`/api/training-sessions/${session.id}/assignments`, {
      data: {
        expectedRevision: current.session.statusRevision,
        groupId: current.session.Groups[0].id,
        problems: [{ problemId: ids.secondProblem, alias: '实时进阶题' }],
      },
    }))
    await expect(student.getByText('实时进阶题', { exact: true })).toBeVisible({ timeout: 7000 })
    await expect(student.getByText('热身题', { exact: true })).toHaveCount(0)
    await coachContext.close()
    await studentContext.close()
  })

  test('E: 暂停、续时和聚焦生命周期保持一致', async ({ browser }) => {
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

    current = await workspace(coachContext.request, session.id)
    expect(current.session.Overlays.some((overlay: any) => overlay.type === 'FOCUS' && overlay.status === 'active')).toBe(true)
    const coach = await coachContext.newPage()
    await coach.goto(`/org/${organizationId}/training-sessions/${session.id}`)
    await expect(coach.getByRole('button', { name: '结束聚焦' })).toBeVisible()

    current = await apiData(await coachContext.request.post(`/api/training-sessions/${session.id}/commands`, {
      data: {
        type: 'END_FOCUS',
        expectedRevision: current.session.statusRevision,
        targetType: 'ALL',
        payload: {},
      },
    }))
    expect(current.session.Overlays.some((overlay: any) => overlay.type === 'FOCUS' && overlay.status === 'active')).toBe(false)

    const originalDuration = current.session.totalDurationSeconds
    current = await apiData(await coachContext.request.post(`/api/training-sessions/${session.id}/commands`, {
      data: {
        type: 'PAUSE_SESSION',
        expectedRevision: current.session.statusRevision,
        targetType: 'ALL',
        payload: {},
      },
    }))
    expect(current.session.status).toBe('PAUSED')
    expect(current.session.runningSince).toBeFalsy()

    current = await apiData(await coachContext.request.post(`/api/training-sessions/${session.id}/commands`, {
      data: {
        type: 'EXTEND_SESSION',
        expectedRevision: current.session.statusRevision,
        targetType: 'ALL',
        payload: { seconds: 600 },
      },
    }))
    expect(current.session.totalDurationSeconds).toBe(originalDuration + 600)
    expect(current.session.status).toBe('PAUSED')

    current = await apiData(await coachContext.request.post(`/api/training-sessions/${session.id}/commands`, {
      data: {
        type: 'RESUME_SESSION',
        expectedRevision: current.session.statusRevision,
        targetType: 'ALL',
        payload: {},
      },
    }))
    expect(current.session.status).toBe('RUNNING')
    expect(current.session.runningSince).toBeTruthy()

    const groupId = current.session.Groups[0].id
    current = await apiData(await coachContext.request.put('/api/training-sessions/' + session.id + '/next-round', {
      data: {
        expectedRevision: current.session.statusRevision,
        name: '限时轮次',
        timeLimitSeconds: 600,
        groups: [{ groupId, problems: [{ problemId: ids.problem }] }],
      },
    }))
    current = await apiData(await coachContext.request.post('/api/training-sessions/' + session.id + '/rounds/advance', {
      data: { expectedRevision: current.session.statusRevision },
    }))
    const roundDuration = current.session.currentRound.timeLimitSeconds
    current = await apiData(await coachContext.request.post('/api/training-sessions/' + session.id + '/commands', {
      data: {
        type: 'EXTEND_ROUND',
        expectedRevision: current.session.statusRevision,
        targetType: 'ALL',
        payload: { seconds: 600 },
      },
    }))
    expect(current.session.currentRound.timeLimitSeconds).toBe(roundDuration + 600)
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
