import { expect, test, type APIRequestContext } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'
import { assertAccessibleState } from '../support/page-audit'
import { prisma } from '../../apps/server/src/prisma'
import { syncTrainingEngineSubmission } from '../../apps/server/src/modules/training-engine/training-engine.service'

const ids = loadFixtureIds()
const base = `/org/org_${ids.school}/training-sessions/${ids.trainingSession}`



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
  const first = workspace.session.Stages.find((stage: any) => stage.Groups.some((group: any) => group.status === 'PENDING'))
  expect(first).toBeTruthy()
  await apiData(await request.post(`/api/training-sessions/${sessionId}/stage-transitions`, {
    data: { expectedRevision: workspace.session.statusRevision, action: 'start', stageId: first.id },
  }))
  return trainingWorkspace(request, sessionId)
}

async function transitionCurrent(request: APIRequestContext, sessionId: string, action: 'advance' | 'end_session', extra: Record<string, unknown> = {}) {
  const workspace = await trainingWorkspace(request, sessionId)
  const current = workspace.session.Stages.find((stage: any) => stage.Groups.some((group: any) => ['RUNNING', 'PAUSED'].includes(group.status)))
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
  problems: [{ problemId }],
  ...extra,
})

test.describe('coach-directed training engine @smoke @compact', () => {
  test('coach creates a draft and visibly arranges the training flow', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const coach = await coachContext.newPage()
    await coach.goto(`/org/org_${ids.school}/training-sessions`)
    await coach.locator('header').getByRole('button', { name: '布置训练' }).click()
    const dialog = coach.getByRole('dialog', { name: '布置训练' })
    await assertAccessibleState(coach)
    await dialog.getByLabel('训练名称').fill('E2E 顺序编排')
    const setupProblemInput = dialog.getByRole('region', { name: '按题号添加' })
    await setupProblemInput.getByLabel('题目平台').selectOption('carits')
    await setupProblemInput.getByLabel('题号').fill('E2E-1000')
    await setupProblemInput.getByRole('button', { name: '添加' }).click()
    await expect(dialog.getByLabel('已选训练题目').getByText(/E2E A Plus B/)).toBeVisible()
    await dialog.getByRole('button', { name: '转为课堂训练' }).click()

    await expect(coach).toHaveURL(/\/training-sessions\/[^/]+\/design$/)
    await expect(coach.getByRole('heading', { name: '训练编排' })).toBeVisible()
    const flow = coach.getByRole('region', { name: '训练流程' })
    await expect(flow).toBeVisible()
    await expect(coach.getByRole('navigation', { name: '训练设计步骤' })).toHaveCount(0)
    await flow.getByText('训练任务', { exact: true }).click()

    const stageDrawer = coach.getByRole('dialog', { name: '训练任务' })
    const problemChain = stageDrawer.getByRole('region', { name: '当前阶段题目链' })
    await expect(problemChain.getByText(/E2E A Plus B/)).toBeVisible()
    await expect(problemChain.getByText('高级设置')).toBeVisible()
    await stageDrawer.getByRole('button', { name: '关闭阶段设置' }).click()

    await coach.getByRole('button', { name: '预览学生视角' }).click()
    await expect(coach.getByRole('dialog', { name: '学生视角预览' }).getByText('E2E-1000', { exact: true }).first()).toBeVisible()
    await coach.getByRole('dialog', { name: '学生视角预览' }).getByRole('button', { name: '关闭预览' }).click()

    await coach.getByRole('button', { name: '设置学员与分组' }).click()
    const rosterDialog = coach.getByRole('dialog', { name: '学员与分组' })
    await expect(rosterDialog.getByRole('heading', { name: '训练学员' })).toBeVisible()
    await rosterDialog.getByRole('button', { name: '关闭' }).last().click()

    await coach.getByRole('button', { name: '管理提示' }).click()
    await expect(coach.getByRole('dialog', { name: '提示' }).getByRole('heading', { name: '提示配置' })).toBeVisible()
    await coach.getByRole('dialog', { name: '提示' }).getByRole('button', { name: '关闭' }).last().click()

    await coach.reload()
    await expect(coach.getByRole('region', { name: '训练流程' }).getByText('训练任务', { exact: true })).toBeVisible()
    await coachContext.close()
  })

  test('coach starts, focuses and pauses while student keeps an isolated draft', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
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
    await expect(start.or(resume)).toBeVisible()
    if (await start.isVisible()) await start.click()
    else await resume.click()
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
    await expect(student.getByText('草稿已保存')).toBeVisible()

    await expect(coach.getByLabel('教练控制对象')).toHaveValue('ALL')
    await coach.getByText('课堂工具', { exact: true }).click()
    await coach.getByRole('button', { name: '聚焦当前题', exact: true }).click()
    await expect(student.getByText('使用训练发布时固定的数据评测', { exact: true })).toBeVisible()
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
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
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

  test('B: one global 当前阶段 advances through warmup, grouped, teaching and review', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const session = await createTrainingSession(coachContext.request, 'E2E B 多阶段', [
      allStage('热身'),
      allStage('分层训练', ids.secondProblem),
      { ...allStage('统一讲解'), kind: 'TEACHING', accessPolicy: 'TEACHER_CONTROLLED', submissionMode: 'DISABLED' },
      { ...allStage('自由补题', ids.thirdProblem), kind: 'REVIEW' },
    ])
    let workspace = await publishAndStart(coachContext.request, session.id)
    expect(workspace.session.Stages.filter((stage: any) => stage.Groups.some((group: any) => group.status === 'RUNNING'))).toHaveLength(1)

    const coach = await coachContext.newPage()
    await coach.goto(sessionPath(session.id))
    for (const expected of ['热身', '分层训练', '统一讲解', '自由补题']) {
      await expect(coach.getByRole('region', { name: '课堂状态' }).getByRole('heading', { name: expected })).toBeVisible()
      workspace = await trainingWorkspace(coachContext.request, session.id)
      expect(workspace.session.Stages.filter((stage: any) => stage.Groups.some((group: any) => group.status === 'RUNNING'))).toHaveLength(1)
      if (expected !== '自由补题') {
        await transitionCurrent(coachContext.request, session.id, 'advance')
        await coach.reload()
      }
    }

    await coachContext.close()
  })

  test('C: immediate group move retires old requirements and opens the new group problem', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const session = await createTrainingSession(coachContext.request, 'E2E C 中途换组', [{
      name: '分层训练',
      kind: 'TRAINING',
      endPolicy: 'MANUAL',
      accessPolicy: 'ALL_AT_ONCE',
      accessScope: 'CURRENT_STAGE',
      submissionMode: 'ENABLED',
      problems: [{ problemId: ids.problem }, { problemId: ids.secondProblem }],
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
    await apiData(await coachContext.request.put(`/api/training-sessions/${session.id}/stage-group-matrix`, {
      data: {
        expectedRevision: design.statusRevision,
        stageGroups: design.stageGroups.map((unit: any) => ({
          ...unit,
          problemIds: [unit.groupName === '基础组' ? foundationProblem.id : advancedProblem.id],
        })),
      },
    }))
    const started = await publishAndStart(coachContext.request, session.id)
    const stage = started.session.Stages[0]
    const foundation = stage.Groups.find((group: any) => group.name === '基础组')
    const advanced = stage.Groups.find((group: any) => group.name === '提高组')
    const participant = await prisma.trainingSessionParticipant.findUniqueOrThrow({
      where: { sessionId_userId: { sessionId: session.id, userId: ids.users.campusStudent } },
    })
    expect(foundation).toBeTruthy()
    expect(advanced).toBeTruthy()

    const student = await studentContext.newPage()
    await student.goto(sessionPath(session.id))
    await expect(student.getByRole('heading', { name: /E2E-1000.*E2E A Plus B/ })).toBeVisible()

    const beforeMove = await trainingWorkspace(coachContext.request, session.id)
    expect((await trainingWorkspace(studentContext.request, session.id)).participant.currentGroupId).toBe(foundation.groupId)
    await apiData(await coachContext.request.post(`/api/training-sessions/${session.id}/stages/${stage.id}/group-changes`, {
      data: {
        expectedRevision: beforeMove.session.statusRevision,
        participantId: participant.id,
        toGroupId: advanced.groupId,
        effectiveMode: 'immediate',
        reason: 'E2E 表现达到提高组标准',
      },
    }))
    expect((await trainingWorkspace(studentContext.request, session.id)).participant.currentGroupId).toBe(advanced.groupId)
    await student.reload()
    await expect(student.getByRole('heading', { name: /E2E-1001.*E2E Sequence/ })).toBeVisible()

    const report = await apiData(await coachContext.request.get(`/api/training-sessions/${session.id}/report`))
    expect(report.groupChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromGroupId: foundation.groupId, toGroupId: advanced.groupId, reason: 'E2E 表现达到提高组标准' }),
    ]))
    await coachContext.close()
    await studentContext.close()
  })

  test('D: early end preserves planned time and reports shorter actual time with explicit reason', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const session = await createTrainingSession(coachContext.request, 'E2E D 提前结束', [
      allStage('40 分钟计划', ids.problem),
    ])
    const design = await apiData(await coachContext.request.get(`/api/training-sessions/${session.id}/design`))
    await apiData(await coachContext.request.put(`/api/training-sessions/${session.id}/stage-group-matrix`, {
      data: {
        expectedRevision: design.statusRevision,
        stageGroups: design.stageGroups.map((unit: any) => ({ ...unit, plannedDurationSeconds: 2400 })),
      },
    }))
    await publishAndStart(coachContext.request, session.id)
    await transitionCurrent(coachContext.request, session.id, 'end_session', {
      outcome: 'ended_early',
      reason: 'E2E 提前完成课堂目标',
    })

    const report = await apiData(await coachContext.request.get(`/api/training-sessions/${session.id}/report`))
    expect(report.timeline[0].groups[0].plannedDurationSeconds).toBe(2400)
    expect(report.timeline[0].groups[0].actualDurationSeconds).toBeLessThan(2400)
    expect(report.timeline[0].groups[0]).toMatchObject({ endReason: 'E2E 提前完成课堂目标' })

    const coach = await coachContext.newPage()
    await coach.goto(sessionPath(session.id))
    await coach.getByText('课堂管理', { exact: true }).click()
    await coach.getByRole('button', { name: '训练报告' }).click()
    const dialog = coach.getByRole('dialog', { name: '训练过程报告' })
    await expect(dialog.getByText(/计划 40:00/)).toBeVisible()
    await expect(dialog.getByText(/E2E 提前完成课堂目标/)).toBeVisible()

    await coachContext.close()
  })

  test('E: progressive score target advances 30 → 60 → 100 without premature completion', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const session = await createTrainingSession(coachContext.request, 'E2E E 部分分', [
      allStage('部分分训练', ids.problem, {
        problems: [{ problemId: ids.problem, scoreGoals: [{ score: 30 }, { score: 60 }, { score: 100 }] }],
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

  test('F: Focus 只能作用于当前阶段且不能泄露未来阶段', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const session = await createTrainingSession(coachContext.request, 'E2E F Focus', [
      allStage('当前阶段', ids.problem),
      allStage('未来阶段', ids.secondProblem),
    ])
    const started = await publishAndStart(coachContext.request, session.id)
    const current = started.session.Stages[0]
    const future = started.session.Stages[1]
    const currentProblem = current.Problems[0]
    const futureProblem = future.Problems[0]

    let workspace = await trainingWorkspace(coachContext.request, session.id)
    const rejected = await coachContext.request.post(`/api/training-sessions/${session.id}/commands`, {
      data: {
        expectedRevision: workspace.session.statusRevision,
        type: 'FOCUS_PROBLEM',
        targetType: 'ALL',
        payload: { stageProblemId: futureProblem.id, mode: 'LOCKED_FOCUS' },
      },
    })
    expect(rejected.status()).toBe(422)

    workspace = await trainingWorkspace(coachContext.request, session.id)
    await apiData(await coachContext.request.post(`/api/training-sessions/${session.id}/commands`, {
      data: {
        expectedRevision: workspace.session.statusRevision,
        type: 'FOCUS_PROBLEM',
        targetType: 'ALL',
        payload: { stageProblemId: currentProblem.id, mode: 'LOCKED_FOCUS' },
      },
    }))

    const student = await studentContext.newPage()
    await student.goto(sessionPath(session.id))
    await expect(student.getByRole('heading', { name: /E2E-1000.*E2E A Plus B/ })).toBeVisible()
    await expect(student.getByText('E2E Sequence')).toHaveCount(0)

    await coachContext.close()
    await studentContext.close()
  })

  test('G: 390x844 课堂状态、学员抽屉与学生任务可见且无横向溢出', async ({ browser }, testInfo) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
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
