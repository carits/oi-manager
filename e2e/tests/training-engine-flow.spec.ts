import { expect, test, type APIRequestContext } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'
import { assertAccessibleState } from '../support/page-audit'
import { prisma } from '../../apps/server/src/prisma'
import { syncTrainingEngineSubmission } from '../../apps/server/src/modules/training-engine/training-engine.service'

const ids = loadFixtureIds()
const base = `/org/org_${ids.school}/training-sessions/${ids.trainingSession}`
const organizationHeaders = { 'X-OI-Organization-ID': 'org_' + ids.school }



type E2EStageInput = Record<string, unknown> & { name: string }

async function apiData(response: Awaited<ReturnType<APIRequestContext['get']>>) {
  const body = await response.json()
  expect(response.ok(), JSON.stringify(body)).toBe(true)
  return body.data
}

async function trainingWorkspace(request: APIRequestContext, sessionId: string) {
  return apiData(await request.get(`/api/training-sessions/${sessionId}`))
}

async function createTrainingSession(request: APIRequestContext, title: string, stages: E2EStageInput[], extra: Record<string, unknown> = {}) {
  return apiData(await request.post('/api/training-sessions', {
    data: {
      title,
      teamId: ids.team,
      participantUserIds: [ids.users.campusStudent],
      settings: { participantTarget: 'custom_students' },
      ...extra,
      stages,
    },
  }))
}

async function publishAndStart(request: APIRequestContext, sessionId: string) {
  let workspace = await trainingWorkspace(request, sessionId)
  await apiData(await request.post(`/api/training-sessions/${sessionId}/publish`, {
    data: { expectedRevision: workspace.session.statusRevision },
  }))
  workspace = await trainingWorkspace(request, sessionId)
  if (workspace.session.status === 'RUNNING') return workspace
  const first = workspace.session.Stages.find((stage: any) => stage.lifecycle === 'PENDING')
  expect(first).toBeTruthy()
  await apiData(await request.post(`/api/training-sessions/${sessionId}/stage-transitions`, {
    data: { expectedRevision: workspace.session.statusRevision, action: 'start', stageId: first.id },
  }))
  return trainingWorkspace(request, sessionId)
}

async function transitionCurrent(request: APIRequestContext, sessionId: string, action: 'advance' | 'end_session', extra: Record<string, unknown> = {}) {
  const workspace = await trainingWorkspace(request, sessionId)
  const current = workspace.session.Stages.find((stage: any) => stage.id === workspace.session.currentStageId)
  expect(current).toBeTruthy()
  return apiData(await request.post(`/api/training-sessions/${sessionId}/stage-transitions`, {
    data: {
      expectedRevision: workspace.session.statusRevision,
      action,
      stageId: current.id,
      outcome: 'completed',
      ...extra,
    },
  }))
}

async function prepareNextStage(request: APIRequestContext, sessionId: string, purpose: 'PRACTICE' | 'GUIDED' | 'TEACHING' | 'REVIEW', stage: E2EStageInput) {
  const workspace = await trainingWorkspace(request, sessionId)
  return apiData(await request.put(`/api/training-sessions/${sessionId}/next-stage`, {
    data: { expectedRevision: workspace.session.statusRevision, purpose, stage: { clientKey: 'next-' + Date.now(), ...stage } },
  }))
}

function sessionPath(sessionId: string) {
  return `/org/org_${ids.school}/training-sessions/${sessionId}`
}

const allStage = (name: string, problemId = ids.problem, extra: Record<string, unknown> = {}) => ({
  name,
  kind: 'TRAINING',
  audienceMode: 'ALL',
  endPolicy: 'MANUAL',
  accessPolicy: 'ALL_AT_ONCE',
  accessScope: 'CURRENT_STAGE',
  submissionMode: 'ENABLED',
  problems: [{ clientKey: 'problem-' + problemId, problemId }],
  ...extra,
})

test.describe('coach-directed training engine @smoke @compact', () => {
  test('coach creates a draft and visibly arranges the training flow', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const coach = await coachContext.newPage()
    await coach.goto(`/org/org_${ids.school}/training-sessions`)
    await coach.locator('header').getByRole('button', { name: '布置训练' }).click()
    const dialog = coach.getByRole('dialog', { name: '布置训练' })
    await assertAccessibleState(coach)
    await dialog.getByLabel('训练名称').fill('E2E 顺序编排')
    await expect(dialog.getByText('训练模板')).toHaveCount(0)
    await expect(dialog.getByText('使用场景')).toHaveCount(0)
    const setupProblemInput = dialog.getByTestId('problem-list-editor')
    await setupProblemInput.getByRole('button', { name: '＋ 添加一道题目', exact: true }).click()
    await setupProblemInput.getByLabel('第 1 题平台', { exact: true }).selectOption('carits')
    const resolved = coach.waitForResponse(response => new URL(response.url()).pathname === '/api/problem-selection/resolve')
    await setupProblemInput.getByRole('textbox', { name: '第 1 题题号', exact: true }).fill('E2E-1000')
    await expect((await resolved).ok()).toBe(true)
    await expect(setupProblemInput.getByRole('link', { name: 'E2E A Plus B', exact: true })).toBeVisible()

    const createRequest = coach.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/training-sessions')
    await expect(dialog.getByRole('button', { name: '继续课堂设置' })).toBeEnabled()
    await dialog.getByRole('button', { name: '继续课堂设置' }).click()
    const createPayload = (await createRequest).postDataJSON()
    expect(createPayload).not.toHaveProperty('templateKey')
    expect(createPayload).toMatchObject({
      sessionType: 'GENERAL',
      rankingMode: 'PROGRESS_ONLY',
      peerVisibility: 'PROGRESS',
      joinMode: 'CURRENT_STAGE',
      allowHints: true,
      settings: { resultVisibility: 'LIVE' },
      stages: [{ name: '训练任务', mode: 'PRACTICE', endPolicy: 'MANUAL', plannedDurationSeconds: null }],
    })

    await expect(coach).toHaveURL(/\/training-sessions\/[^/]+\/design$/)
    await expect(coach.getByRole('heading', { name: '设置第一个阶段' })).toBeVisible()
    await expect(coach.getByRole('textbox', { name: '阶段名称' })).toHaveValue('训练任务')
    await expect(coach.getByText('E2E A Plus B', { exact: true })).toBeVisible()
    await expect(coach.getByText('训练流程')).toHaveCount(0)
    await expect(coach.getByText('选择多个阶段')).toHaveCount(0)
    await expect(coach.getByText('复制阶段')).toHaveCount(0)
    await expect(coach.getByText('查看全部分组方案')).toHaveCount(0)
    await coach.reload()
    await expect(coach.getByRole('heading', { name: '设置第一个阶段' })).toBeVisible()
    await expect(coach.getByText('E2E A Plus B', { exact: true })).toBeVisible()
    await coachContext.close()
  })

  test('coach starts, focuses and pauses while student keeps an isolated draft', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState, extraHTTPHeaders: organizationHeaders })
    const coach = await coachContext.newPage(), student = await studentContext.newPage()

    await coach.goto(base)
    const baseWorkspace = await trainingWorkspace(coachContext.request, ids.trainingSession)
    if (baseWorkspace.session.status === 'DRAFT') {
      await apiData(await coachContext.request.post(`/api/training-sessions/${ids.trainingSession}/publish`, {
        data: { expectedRevision: baseWorkspace.session.statusRevision },
      }))
      await coach.reload()
    }
    await expect(coach.getByRole('heading', { name: 'E2E 教练训练' })).toBeVisible()
    const start = coach.getByRole('button', { name: '开始训练', exact: true })
    const resume = coach.getByRole('button', { name: '恢复训练', exact: true })
    if (await start.isVisible()) await start.click()
    else if (await resume.isVisible()) await resume.click()
    await expect(coach.locator('span').filter({ hasText: /^进行中$/ }).first()).toBeVisible()
    const classroomStatus = coach.getByRole('region', { name: '课堂状态' })
    await expect(classroomStatus).toBeVisible()
    await expect(classroomStatus.getByRole('button')).toHaveCount(2)
    await expect(coach.getByRole('heading', { name: '需要关注' })).toBeVisible()
    await coach.getByRole('button', { name: /student1/ }).last().click()
    await expect(coach.getByRole('dialog', { name: 'student1' })).toBeVisible()
    await coach.keyboard.press('Escape')
    await expect(coach.getByRole('dialog', { name: 'student1' })).toHaveCount(0)

    await student.goto(base)
    await expect(student.getByRole('region', { name: '我的当前训练目标' })).toBeVisible()
    await expect(student.getByRole('button', { name: '继续做题' })).toBeVisible()
    await expect(student.getByRole('heading', { name: /A.*E2E A Plus B/ })).toBeVisible()
    const editor = student.getByLabel('提交源码')
    await editor.fill('#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}')
    await student.getByRole('button', { name: '保存草稿' }).click()
    await expect(student.getByText('草稿已同步', { exact: true })).toBeVisible()

    await expect(coach.getByLabel('教练控制对象')).toHaveValue('ALL')
    await coach.getByText('课堂工具', { exact: true }).click()
    await coach.getByRole('button', { name: '聚焦当前题', exact: true }).click()
    await expect(student.getByText('提交时使用当前训练数据评测', { exact: true })).toBeVisible()
    await coach.getByRole('button', { name: '暂停提交与编辑', exact: true }).click()
    await expect(student.getByRole('region', { name: '我的当前训练目标' }).getByText('已暂停', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(student.getByRole('button', { name: '提交评测' })).toBeDisabled()
    await expect(student.getByLabel('提交源码')).toHaveAttribute('aria-readonly', 'true')
    await student.reload()
    await expect(student.getByLabel('提交源码')).toContainText('std::cout')

    await coachContext.close(); await studentContext.close()
  })
})


test.describe('stage-driven training acceptance', () => {
  test('A: 单阶段支持创建、发布、学生提交和报告', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await createTrainingSession(coachContext.request, 'E2E A 单阶段', [allStage('单阶段训练')])
    await publishAndStart(coachContext.request, session.id)

    const student = await studentContext.newPage()
    await student.goto(sessionPath(session.id))
    await expect(student.getByRole('heading', { name: /E2E-1000.*E2E A Plus B/ })).toBeVisible()
    await expect(student.getByText(/草稿已同步/)).toBeVisible()
    await student.getByLabel('提交源码').fill('#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}')
    const submitResponsePromise = student.waitForResponse(response => response.url().includes(`/api/training-sessions/${session.id}/submit`) && response.request().method() === 'POST')
    await student.getByRole('button', { name: '提交评测' }).click()
    const submitResponse = await submitResponsePromise
    expect(submitResponse.status()).toBe(201)
    await expect(student.getByText(/提交 #\d+ 已进入评测队列，代码已保留，可继续修改/)).toBeVisible()

    const coach = await coachContext.newPage()
    await coach.goto(sessionPath(session.id))
    await coach.getByText('课堂管理', { exact: true }).click()
    await coach.getByRole('button', { name: '训练报告' }).click()
    await expect(coach.getByRole('dialog', { name: '训练过程报告' })).toBeVisible()
    await expect(coach.getByText('训练汇总', { exact: true })).toBeVisible()

    await coachContext.close()
    await studentContext.close()
  })

  test('B: 课堂根据反馈逐步准备练习、讲解与复盘', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await createTrainingSession(coachContext.request, 'E2E B 渐进课堂', [allStage('热身')])
    let workspace = await publishAndStart(coachContext.request, session.id)
    expect(workspace.session.currentStage.name).toBe('热身')
    expect(workspace.nextStage).toBeNull()

    workspace = await prepareNextStage(coachContext.request, session.id, 'GUIDED', allStage('针对练习', ids.secondProblem))
    expect(workspace.nextStage.name).toBe('针对练习')
    workspace = await transitionCurrent(coachContext.request, session.id, 'advance', { nextStageId: workspace.nextStage.id })
    expect(workspace.session.currentStage.name).toBe('针对练习')

    workspace = await prepareNextStage(coachContext.request, session.id, 'TEACHING', {
      name: '统一讲解', kind: 'TEACHING', mode: 'GUIDED', accessPolicy: 'ALL_AT_ONCE',
      submissionMode: 'DISABLED', endPolicy: 'MANUAL', problems: [],
    })
    workspace = await transitionCurrent(coachContext.request, session.id, 'advance', { nextStageId: workspace.nextStage.id })
    expect(workspace.session.currentStage.name).toBe('统一讲解')

    workspace = await prepareNextStage(coachContext.request, session.id, 'REVIEW', {
      name: '课堂复盘', kind: 'REVIEW', mode: 'REVIEW', accessPolicy: 'ALL_AT_ONCE',
      submissionMode: 'DISABLED', endPolicy: 'MANUAL', problems: [],
    })
    workspace = await transitionCurrent(coachContext.request, session.id, 'advance', { nextStageId: workspace.nextStage.id })
    expect(workspace.session.currentStage.name).toBe('课堂复盘')

    const coach = await coachContext.newPage()
    await coach.goto(sessionPath(session.id))
    await expect(coach.getByRole('heading', { name: '课堂复盘' })).toBeVisible()
    await expect(coach.getByRole('heading', { name: '下一步' })).toBeVisible()
    await expect(coach.getByText('尚未准备下一阶段')).toBeVisible()
    await coachContext.close()
  })

  test('C: immediate group move retires old requirements and opens the new group problem', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await createTrainingSession(coachContext.request, 'E2E C 中途换组', [{
      name: '分层训练',
      kind: 'TRAINING',
      endPolicy: 'MANUAL',
      accessPolicy: 'ALL_AT_ONCE',
      accessScope: 'CURRENT_STAGE',
      submissionMode: 'ENABLED',
      problems: [{ clientKey: 'foundation-problem', problemId: ids.problem }, { clientKey: 'advanced-problem', problemId: ids.secondProblem }],
    }], {
      grouping: { groups: [
        { clientKey: 'foundation', name: '基础组', participantIds: [ids.users.campusStudent] },
        { clientKey: 'advanced', name: '提高组', participantIds: [] },
      ] },
    })
    const design = await apiData(await coachContext.request.get(`/api/training-sessions/${session.id}/design`))
    const designStage = design.stages[0]
    const foundationProblem = designStage.Problems.find((problem: any) => problem.Problem.id === ids.problem)
    const advancedProblem = designStage.Problems.find((problem: any) => problem.Problem.id === ids.secondProblem)
    expect(foundationProblem).toBeTruthy()
    expect(advancedProblem).toBeTruthy()
    const defaultPlan = design.stagePlans.find((unit: any) => unit.isDefault)
    expect(defaultPlan).toBeTruthy()
    const groupPlans = design.groups.map((group: any) => {
      const problemId = group.name === '提高组' ? advancedProblem.id : foundationProblem.id
      return {
        ...defaultPlan,
        id: undefined,
        clientKey: 'e2e-plan-' + group.id,
        groupId: group.id,
        groupName: group.name,
        isDefault: false,
        inheritsDefault: false,
        problemIds: [problemId],
        requiredProblemIds: [problemId],
      }
    })
    await apiData(await coachContext.request.put(`/api/training-sessions/${session.id}/stage-group-matrix`, {
      data: {
        expectedRevision: design.statusRevision,
        stagePlans: [
          { ...defaultPlan, problemIds: [foundationProblem.id], requiredProblemIds: [foundationProblem.id] },
          ...groupPlans,
        ],
      },
    }))
    const started = await publishAndStart(coachContext.request, session.id)
    const stage = started.session.Stages[0]
    const foundation = started.session.Groups.find((group: any) => group.name === '基础组')
    const advanced = started.session.Groups.find((group: any) => group.name === '提高组')
    const participant = await prisma.trainingSessionParticipant.findUniqueOrThrow({
      where: { sessionId_userId: { sessionId: session.id, userId: ids.users.campusStudent } },
    })
    expect(foundation).toBeTruthy()
    expect(advanced).toBeTruthy()

    const student = await studentContext.newPage()
    await student.goto(sessionPath(session.id))
    await expect(student.getByRole('heading', { name: /E2E-1000.*E2E A Plus B/ })).toBeVisible()

    const beforeMove = await trainingWorkspace(coachContext.request, session.id)
    expect((await trainingWorkspace(studentContext.request, session.id)).participant.currentGroupId).toBe(foundation.id)
    await apiData(await coachContext.request.post(`/api/training-sessions/${session.id}/stages/${stage.id}/group-changes`, {
      data: {
        expectedRevision: beforeMove.session.statusRevision,
        participantIds: [participant.id],
        toGroupId: advanced.id,
        effectiveMode: 'immediate',
        reason: 'E2E 表现达到提高组标准',
      },
    }))
    expect((await trainingWorkspace(studentContext.request, session.id)).participant.currentGroupId).toBe(advanced.id)
    await student.reload()
    await expect(student.getByRole('heading', { name: /E2E-1001.*E2E Sequence/ })).toBeVisible()

    const report = await apiData(await coachContext.request.get(`/api/training-sessions/${session.id}/report`))
    expect(report.groupChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromGroupId: foundation.id, toGroupId: advanced.id, reason: 'E2E 表现达到提高组标准' }),
    ]))
    await coachContext.close()
    await studentContext.close()
  })

  test('D: early end preserves planned time and reports shorter actual time with explicit reason', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await createTrainingSession(coachContext.request, 'E2E D 提前结束', [
      allStage('40 分钟计划', ids.problem, { plannedDurationSeconds: 2400 }),
    ])
    await publishAndStart(coachContext.request, session.id)
    await transitionCurrent(coachContext.request, session.id, 'end_session', {
      outcome: 'ended_early',
      reason: 'E2E 提前完成课堂目标',
    })

    const report = await apiData(await coachContext.request.get(`/api/training-sessions/${session.id}/report`))
    expect(report.timeline[0].plannedDurationSeconds).toBe(2400)
    expect(report.timeline[0].actualDurationSeconds).toBeLessThan(2400)
    expect(report.timeline[0]).toMatchObject({ endReason: 'TEACHER_ENDED_EARLY' })

    const coach = await coachContext.newPage()
    await coach.goto(sessionPath(session.id))
    await coach.getByText('课堂管理', { exact: true }).click()
    await coach.getByRole('button', { name: '训练报告' }).click()
    const dialog = coach.getByRole('dialog', { name: '训练过程报告' })
    await expect(dialog.getByText(/计划 40:00/)).toBeVisible()
    await expect(dialog.getByText(/教师提前结束/)).toBeVisible()

    await coachContext.close()
  })

  test('E: progressive score target advances 30 → 60 → 100 without premature completion', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await createTrainingSession(coachContext.request, 'E2E E 部分分', [
      allStage('部分分训练', ids.problem, {
        problems: [{ clientKey: 'score-goal-problem', problemId: ids.problem, scoreGoals: [{ score: 30 }, { score: 60 }, { score: 100 }] }],
      }),
    ])
    await publishAndStart(coachContext.request, session.id)
    const stageProblem = await prisma.trainingSessionStageProblem.findFirstOrThrow({ where: { Stage: { sessionId: session.id } } })
    const problem = await prisma.problem.findUniqueOrThrow({ where: { id: ids.problem } })

    const student = await studentContext.newPage()
    await student.goto(sessionPath(session.id))
    await expect(student.getByRole('region', { name: '我的当前训练目标' }).getByText(/目标：30/)).toBeVisible()

    for (const score of [30, 60, 100]) {
      const submission = await prisma.submission.create({
        data: {
          userId: ids.users.campusStudent,
          oj: 'carits',
          problemId: problem.problemId,
          language: 'cpp17',
          code: 'int main(){}',
          codeLength: 12,
          submitMethod: 'local',
          submitScope: 'training_engine',
          trainingSessionId: session.id,
          trainingStageProblemId: stageProblem.id,
        },
      })
      await syncTrainingEngineSubmission({
        id: submission.id,
        userId: ids.users.campusStudent,
        trainingSessionId: session.id,
        trainingStageProblemId: stageProblem.id,
        result: score === 100 ? 'Accepted' : 'Partial Accepted',
        score,
        trainingScoreGoalSnapshot: { score },
      })
      await student.reload()
      if (score < 100) await expect(student.getByRole('region', { name: '我的当前训练目标' }).getByText(new RegExp(`当前最高分：${score}.*目标：${score === 30 ? 60 : 100}`))).toBeVisible()
    }
    await expect(student.getByRole('region', { name: '我的当前训练目标' }).getByText('1 / 1', { exact: true })).toBeVisible()

    await coachContext.close()
    await studentContext.close()
  })

  test('F: Focus 只能作用于当前阶段且学生不能看见下一阶段', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await createTrainingSession(coachContext.request, 'E2E F Focus', [allStage('当前阶段', ids.problem)])
    let workspace = await publishAndStart(coachContext.request, session.id)
    workspace = await prepareNextStage(coachContext.request, session.id, 'PRACTICE', allStage('未来阶段', ids.secondProblem))
    const current = workspace.session.Stages.find((stage: any) => stage.id === workspace.session.currentStageId)
    const future = workspace.nextStage
    const currentProblem = current.Problems[0]
    const futureProblem = future.Problems[0]

    const rejected = await coachContext.request.post(`/api/training-sessions/${session.id}/commands`, {
      data: { expectedRevision: workspace.session.statusRevision, type: 'FOCUS_PROBLEM', targetType: 'ALL', payload: { stageProblemId: futureProblem.id, mode: 'LOCKED_FOCUS' } },
    })
    expect(rejected.status()).toBe(422)

    workspace = await trainingWorkspace(coachContext.request, session.id)
    await apiData(await coachContext.request.post(`/api/training-sessions/${session.id}/commands`, {
      data: { expectedRevision: workspace.session.statusRevision, type: 'FOCUS_PROBLEM', targetType: 'ALL', payload: { stageProblemId: currentProblem.id, mode: 'LOCKED_FOCUS' } },
    }))

    const studentWorkspace = await trainingWorkspace(studentContext.request, session.id)
    expect(studentWorkspace.nextStage).toBeUndefined()
    expect(studentWorkspace.session.Stages.some((stage: any) => stage.lifecycle === 'PENDING')).toBe(false)
    const student = await studentContext.newPage()
    await student.goto(sessionPath(session.id))
    await expect(student.getByRole('heading', { name: /E2E-1000.*E2E A Plus B/ })).toBeVisible()
    await expect(student.getByText('E2E Sequence')).toHaveCount(0)
    await coachContext.close()
    await studentContext.close()
  })

  test('G: 390x844 课堂状态、学员抽屉与学生任务可见且无横向溢出', async ({ browser }, testInfo) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState, extraHTTPHeaders: organizationHeaders })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState, extraHTTPHeaders: organizationHeaders })
    const session = await createTrainingSession(coachContext.request, 'E2E G 移动端验收', [allStage('移动课堂')])
    await publishAndStart(coachContext.request, session.id)

    const browserErrors: string[] = []
    const trackErrors = (page: import('@playwright/test').Page) => {
      page.on('console', message => {
        if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`)
      })
      page.on('pageerror', error => browserErrors.push(`pageerror: ${error.message}`))
    }
    const assertNoHorizontalOverflow = async (page: import('@playwright/test').Page) => {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }

    const coach = await coachContext.newPage()
    await coach.setViewportSize({ width: 390, height: 844 })
    trackErrors(coach)
    await coach.goto(sessionPath(session.id))
    await expect(coach.getByRole('region', { name: '课堂状态' })).toBeVisible()
    await expect(coach.getByRole('heading', { name: '需要关注' })).toBeVisible()
    await assertNoHorizontalOverflow(coach)
    await coach.screenshot({ path: testInfo.outputPath('mobile-coach-runtime.png'), fullPage: true })

    const participantButton = coach.getByRole('button', { name: /student1/ }).last()
    await expect(participantButton).toBeVisible()
    await participantButton.click()
    await expect(coach.getByRole('dialog', { name: 'student1' })).toBeVisible()
    await assertNoHorizontalOverflow(coach)
    await coach.screenshot({ path: testInfo.outputPath('mobile-participant-drawer.png'), fullPage: true })
    await coach.keyboard.press('Escape')

    const student = await studentContext.newPage()
    await student.setViewportSize({ width: 390, height: 844 })
    trackErrors(student)
    await student.goto(sessionPath(session.id))
    await expect(student.getByRole('region', { name: '我的当前训练目标' })).toBeVisible()
    await expect(student.getByRole('button', { name: '继续做题' })).toBeVisible()
    await assertNoHorizontalOverflow(student)
    await student.screenshot({ path: testInfo.outputPath('mobile-student-mission.png'), fullPage: true })

    expect(browserErrors).toEqual([])
    await coachContext.close()
    await studentContext.close()
  })

})
