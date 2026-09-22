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

async function createTrainingSession(request: APIRequestContext, title: string, stages: E2EStageInput[]) {
  return apiData(await request.post('/api/training-sessions', {
    data: {
      title,
      teamId: ids.team,
      participantUserIds: [ids.users.campusStudent],
      settings: { participantTarget: 'custom_students' },
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
  test('coach creates a draft and visibly arranges stage and problem order', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const coach = await coachContext.newPage()
    await coach.goto(`/org/org_${ids.school}/training-sessions`)
    await coach.getByRole('button', { name: '创建训练' }).click()
    const dialog = coach.getByRole('dialog', { name: '创建训练' })
    await assertAccessibleState(coach)
    await dialog.getByRole('tab', { name: '使用 Stage 模板' }).click()
    await dialog.getByLabel('训练名称').fill('E2E 顺序编排')
    await dialog.getByRole('button', { name: '创建并编排' }).click()
    await expect(coach).toHaveURL(/\/training-sessions\/[^/]+\/design$/)
    await expect(coach.getByRole('region', { name: '阶段时间线' })).toBeVisible()
    await expect(coach.getByRole('region', { name: '当前阶段题目链' })).toBeVisible()
    const problemInput = coach.getByRole('region', { name: '按题号添加' })
    await expect(problemInput).toBeVisible()
    await problemInput.getByLabel('题目平台').selectOption('carits')
    await problemInput.getByLabel('题号').fill('E2E-1000')
    await problemInput.getByRole('button', { name: '添加' }).click()
    await expect(problemInput.getByText(/E2E A Plus B/)).toBeVisible()
    await expect(coach.getByRole('heading', { name: '完整流程预览' })).toBeVisible()
    await coach.getByRole('button', { name: '保存编排' }).click()
    const savedToast = coach.getByText('编排已保存，题目分配 ID 和固定版本保持稳定')
    await expect(savedToast).toBeVisible()
    await expect(savedToast).toBeHidden({ timeout: 10_000 })
    await coach.reload()
    await expect(coach.getByRole('heading', { name: '完整流程预览' })).toBeVisible()
    await coach.getByRole('button', { name: '3 学员与分组' }).click()
    await expect(coach.getByRole('heading', { name: '学员与分组' })).toBeVisible()
    await coach.getByRole('button', { name: '4 提示配置' }).click()
    await expect(coach.getByRole('heading', { name: '提示配置' })).toBeVisible()
    await coach.getByRole('button', { name: '5 发布检查' }).click()
    await expect(coach.getByRole('heading', { name: '发布检查' })).toBeVisible()
    await coachContext.close()
  })

  test('coach starts, focuses and pauses while student keeps an isolated draft', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const coach = await coachContext.newPage(), student = await studentContext.newPage()

    await coach.goto(base)
    await expect(coach.getByRole('heading', { name: 'E2E 教练训练' })).toBeVisible()
    const start = coach.getByRole('button', { name: '开始', exact: true })
    const resume = coach.getByRole('button', { name: '恢复', exact: true })
    await expect(start.or(resume)).toBeVisible()
    if (await start.isVisible()) await start.click()
    else await resume.click()
    await expect(coach.getByText('进行中', { exact: true })).toBeVisible()

    await student.goto(base)
    await expect(student.getByRole('heading', { name: /A.*E2E A Plus B/ })).toBeVisible()
    const editor = student.getByLabel('代码草稿')
    await editor.fill('#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}')
    await student.getByRole('button', { name: '保存草稿' }).click()
    await expect(student.getByText('草稿已保存')).toBeVisible()

    await expect(coach.getByLabel('教练控制对象')).toHaveValue('ALL')
    await coach.getByRole('button', { name: '聚焦当前题', exact: true }).click()
    await expect(student.getByText('使用训练发布时固定的数据评测', { exact: true })).toBeVisible()
    await coach.getByRole('button', { name: '硬暂停', exact: true }).click()
    await expect(student.getByText('已暂停', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(student.getByRole('button', { name: '提交评测' })).toBeDisabled()
    await expect(student.getByLabel('代码草稿')).toBeDisabled()
    await student.reload()
    await expect(student.getByLabel('代码草稿')).toHaveValue(/std::cout/)

    await coachContext.close(); await studentContext.close()
  })
})


test.describe('stage-driven training acceptance', () => {
  test('A: single Stage supports create, publish, student submit and report', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const session = await createTrainingSession(coachContext.request, 'E2E A 单 Stage', [allStage('单阶段训练')])
    await publishAndStart(coachContext.request, session.id)

    const student = await studentContext.newPage()
    await student.goto(sessionPath(session.id))
    await expect(student.getByRole('heading', { name: /E2E-1000.*E2E A Plus B/ })).toBeVisible()
    await student.getByLabel('代码草稿').fill('#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}')
    await student.getByRole('button', { name: '提交评测' }).click()
    await expect(student.getByText(/已进入评测队列，代码已保留/)).toBeVisible()

    const coach = await coachContext.newPage()
    await coach.goto(sessionPath(session.id))
    await coach.getByRole('button', { name: '训练报告' }).click()
    await expect(coach.getByRole('dialog', { name: '训练过程报告' })).toBeVisible()
    await expect(coach.getByText('Session 汇总', { exact: true })).toBeVisible()

    await coachContext.close()
    await studentContext.close()
  })

  test('B: one global current Stage advances through warmup, grouped, teaching and review', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const session = await createTrainingSession(coachContext.request, 'E2E B 多 Stage', [
      allStage('热身'),
      {
        name: '分层训练',
        kind: 'TRAINING',
        audienceMode: 'GROUPED',
        endPolicy: 'MANUAL',
        accessPolicy: 'ALL_AT_ONCE',
        accessScope: 'CURRENT_STAGE',
        submissionMode: 'ENABLED',
        problems: [],
        groups: [
          { clientKey: 'foundation', name: '基础组', participantIds: [ids.users.campusStudent], problems: [{ problemId: ids.problem }] },
          { clientKey: 'advanced', name: '提高组', participantIds: [], problems: [{ problemId: ids.secondProblem }] },
        ],
      },
      { ...allStage('统一讲解'), kind: 'TEACHING', accessPolicy: 'TEACHER_CONTROLLED', submissionMode: 'DISABLED', problems: [] },
      { ...allStage('自由补题', ids.thirdProblem), kind: 'REVIEW' },
    ])
    let workspace = await publishAndStart(coachContext.request, session.id)
    expect(workspace.session.Stages.filter((stage: any) => stage.lifecycle === 'RUNNING')).toHaveLength(1)

    const coach = await coachContext.newPage()
    await coach.goto(sessionPath(session.id))
    for (const expected of ['热身', '分层训练', '统一讲解', '自由补题']) {
      await expect(coach.getByRole('heading', { name: `当前 Stage · ${expected}` })).toBeVisible()
      workspace = await trainingWorkspace(coachContext.request, session.id)
      expect(workspace.session.Stages.filter((stage: any) => stage.lifecycle === 'RUNNING')).toHaveLength(1)
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
      audienceMode: 'GROUPED',
      endPolicy: 'MANUAL',
      accessPolicy: 'ALL_AT_ONCE',
      accessScope: 'CURRENT_STAGE',
      submissionMode: 'ENABLED',
      problems: [],
      groups: [
        { clientKey: 'foundation', name: '基础组', participantIds: [ids.users.campusStudent], problems: [{ problemId: ids.problem }] },
        { clientKey: 'advanced', name: '提高组', participantIds: [], problems: [{ problemId: ids.secondProblem }] },
      ],
    }])
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
    await expect(student.getByText('基础组', { exact: true })).toBeVisible()
    await expect(student.getByRole('heading', { name: /E2E-1000.*E2E A Plus B/ })).toBeVisible()

    const beforeMove = await trainingWorkspace(coachContext.request, session.id)
    await apiData(await coachContext.request.post(`/api/training-sessions/${session.id}/stages/${stage.id}/group-changes`, {
      data: {
        expectedRevision: beforeMove.session.statusRevision,
        participantId: participant.id,
        toGroupId: advanced.id,
        effectiveMode: 'immediate',
        reason: 'E2E 表现达到提高组标准',
      },
    }))
    await student.reload()
    await expect(student.getByText('提高组', { exact: true })).toBeVisible()
    await expect(student.getByRole('heading', { name: /E2E-1001.*E2E Sequence/ })).toBeVisible()

    const report = await apiData(await coachContext.request.get(`/api/training-sessions/${session.id}/report`))
    expect(report.groupChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromGroupId: foundation.id, toGroupId: advanced.id, effectiveMode: 'IMMEDIATE' }),
    ]))
    await coachContext.close()
    await studentContext.close()
  })

  test('D: early end preserves planned time and reports shorter actual time with explicit reason', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
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
    expect(report.timeline[0]).toMatchObject({ endReason: 'TEACHER_ENDED_EARLY', endNote: 'E2E 提前完成课堂目标' })

    const coach = await coachContext.newPage()
    await coach.goto(sessionPath(session.id))
    await coach.getByRole('button', { name: '训练报告' }).click()
    const dialog = coach.getByRole('dialog', { name: '训练过程报告' })
    await expect(dialog.getByText(/计划 40 分钟/)).toBeVisible()
    await expect(dialog.getByText(/TEACHER_ENDED_EARLY/)).toBeVisible()

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
    await expect(student.getByText('0 → 30', { exact: true })).toBeVisible()

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
          result: score === 100 ? 'Accepted' : 'Partial Accepted',
          score,
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
      if (score < 100) await expect(student.getByText(`${score} → ${score === 30 ? 60 : 100}`, { exact: true })).toBeVisible()
    }
    await expect(student.getByText('1/1', { exact: true })).toBeVisible()

    await coachContext.close()
    await studentContext.close()
  })

  test('F: Focus can target only the current Stage and cannot reveal a future Stage', async ({ browser }) => {
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
})
