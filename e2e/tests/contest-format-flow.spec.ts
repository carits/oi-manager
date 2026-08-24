import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { bearer, loginAs, type AuthSession } from '../fixtures/api'
import { loadFixtureIds } from '../fixtures/data'
import { loadRuntimeSecrets } from '../fixtures/runtime'

const ids = loadFixtureIds()
const { judgeToken } = loadRuntimeSecrets()
const organizationBase = `/org/org_${ids.school}`

function workHeaders(session: AuthSession) {
  return { ...bearer(session), 'X-OI-Organization-ID': `org_${ids.school}` }
}

async function setJudgeMode(request: APIRequestContext, manager: AuthSession, mode: 'acm' | 'oi') {
  const cases = mode === 'oi'
    ? [{ input: '1.in', output: '1.out', score: 100, subtaskId: 1 }]
    : [{ input: '1.in', output: '1.out' }]
  const response = await request.put(`/api/problems/${ids.problem}/judge-config`, {
    headers: bearer(manager),
    data: {
      problemType: 'standard',
      timeLimit: 1000,
      memoryLimit: 256,
      config: {
        mode,
        type: 'default',
        time: '1000ms',
        memory: '256MB',
        cases,
        ...(mode === 'oi' ? { subtasks: [{ id: 1, score: 100, type: 'sum', cases }] } : {}),
      },
    },
  })
  expect(response.status()).toBe(200)
}

async function createContest(
  request: APIRequestContext,
  principal: AuthSession,
  format: 'icpc' | 'oi' | 'ioi',
) {
  const now = Date.now()
  const created = await request.post(`/api/teams/${ids.team}/trainings`, {
    headers: workHeaders(principal),
    data: {
      title: `E2E ${format.toUpperCase()} Full Flow ${now}`,
      description: 'Deterministic destructive contest-format flow',
      format,
      type: 'contest',
      startTime: new Date(now + 5 * 60_000).toISOString(),
      endTime: new Date(now + 65 * 60_000).toISOString(),
      problemIdVisible: true,
      solutionVisible: false,
      includeAdminInRanking: false,
    },
  })
  expect(created.status()).toBe(200)
  const trainingId = String((await created.json()).data.id)

  const added = await request.post(`/api/trainings/${trainingId}/problems`, {
    headers: workHeaders(principal),
    data: { problemId: ids.problem, alias: 'A', points: 100 },
  })
  expect(added.status()).toBe(200)
  const trainingProblemId = String((await added.json()).data.id)
  return { trainingId, trainingProblemId }
}

async function startContest(request: APIRequestContext, principal: AuthSession, trainingId: string) {
  const response = await request.post(`/api/trainings/${trainingId}/start`, {
    headers: workHeaders(principal),
  })
  expect(response.status()).toBe(200)
}

async function submitCode(
  request: APIRequestContext,
  student: AuthSession,
  contest: { trainingId: string; trainingProblemId: string },
  code: string,
) {
  const response = await request.post(`/api/trainings/${contest.trainingId}/submit`, {
    headers: {
      ...workHeaders(student),
      'Idempotency-Key': `format-flow-${contest.trainingId}-${Date.now()}-${Math.random()}`,
    },
    data: {
      trainingProblemId: contest.trainingProblemId,
      language: 'cpp',
      code,
      submitMethod: 'local',
    },
  })
  expect(response.status()).toBe(200)
  return String((await response.json()).data.submissionId)
}

async function completeJudge(
  page: Page,
  submissionId: string,
  result: 'Accepted' | 'Wrong Answer',
  score: number,
) {
  await page.evaluate(
    ({ expectedSubmissionId, token, judgeResult, judgeScore }) => new Promise<void>((resolve, reject) => {
      const socket = new WebSocket('ws://127.0.0.1:3102/ws/judge')
      const timeout = window.setTimeout(() => {
        socket.close()
        reject(new Error(`Timed out waiting for submission ${expectedSubmissionId}`))
      }, 15_000)
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', payload: { token } })))
      socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data))
        if (message.type === 'auth_success') {
          socket.send(JSON.stringify({
            type: 'register',
            payload: { judgeId: `format-flow-${expectedSubmissionId}`, languages: ['cpp'] },
          }))
        } else if (message.type === 'registered') {
          socket.send(JSON.stringify({ type: 'start', payload: { concurrency: 1 } }))
        } else if (message.type === 'judge') {
          if (String(message.payload.submissionId) !== expectedSubmissionId) {
            window.clearTimeout(timeout)
            socket.close()
            reject(new Error(`Unexpected submission ${message.payload.submissionId}`))
            return
          }
          const caseResult = {
            caseId: 0,
            subtaskId: 1,
            result: judgeResult,
            time: 3,
            cpuTime: 3,
            wallTime: 4,
            memory: 1024,
            score: judgeScore,
          }
          socket.send(JSON.stringify({
            type: 'result',
            payload: {
              submissionId: expectedSubmissionId,
              result: judgeResult,
              time: 3,
              wallTime: 4,
              memory: 1024,
              score: judgeScore,
              cases: [caseResult],
              subtasks: [{ id: 1, type: 'sum', score: judgeScore, cases: [caseResult] }],
            },
          }))
          window.clearTimeout(timeout)
          window.setTimeout(() => {
            socket.close()
            resolve()
          }, 300)
        } else if (message.type === 'error') {
          window.clearTimeout(timeout)
          socket.close()
          reject(new Error(message.payload?.message || 'Judge error'))
        }
      })
      socket.addEventListener('error', () => reject(new Error('Judge socket failed')))
    }),
    { expectedSubmissionId: submissionId, token: judgeToken, judgeResult: result, judgeScore: score },
  )
}

async function waitForResult(
  request: APIRequestContext,
  principal: AuthSession,
  trainingId: string,
  submissionId: string,
  expected: string,
) {
  await expect.poll(async () => {
    const response = await request.get(`/api/trainings/${trainingId}/submissions/${submissionId}`, {
      headers: workHeaders(principal),
    })
    if (!response.ok()) return `http-${response.status()}`
    return (await response.json()).data.result
  }).toBe(expected)
}

test('ICPC, OI and IOI complete submission, ranking, detail and finish flows', async ({ browser, page, request }) => {
  const principal = await loginAs(request, 'principal')
  const platformAdmin = await loginAs(request, 'platformAdmin')
  const student = await loginAs(request, 'campusStudent')
  const contests: Array<{ trainingId: string; trainingProblemId: string }> = []
  let restoredAcm = false

  try {
    const icpc = await createContest(request, principal, 'icpc')
    contests.push(icpc)
    await setJudgeMode(request, platformAdmin, 'oi')
    const oi = await createContest(request, principal, 'oi')
    const ioi = await createContest(request, principal, 'ioi')
    contests.push(oi, ioi)
    await setJudgeMode(request, platformAdmin, 'acm')
    restoredAcm = true

    for (const contest of contests) await startContest(request, principal, contest.trainingId)
    await page.goto('/login')

    const icpcWrong = await submitCode(request, student, icpc, 'int main(){return 1;}')
    await completeJudge(page, icpcWrong, 'Wrong Answer', 0)
    await waitForResult(request, principal, icpc.trainingId, icpcWrong, 'wa')
    const icpcAccepted = await submitCode(request, student, icpc, '#include <iostream>\nint main(){std::cout<<2;}')
    await completeJudge(page, icpcAccepted, 'Accepted', 100)
    await waitForResult(request, principal, icpc.trainingId, icpcAccepted, 'accepted')

    const oiPartial = await submitCode(request, student, oi, '#include <iostream>\nint main(){std::cout<<0;}')
    await completeJudge(page, oiPartial, 'Wrong Answer', 40)
    await waitForResult(request, principal, oi.trainingId, oiPartial, 'wa')
    const ioiPartial = await submitCode(request, student, ioi, '#include <iostream>\nint main(){std::cout<<0;}')
    await completeJudge(page, ioiPartial, 'Wrong Answer', 40)
    await waitForResult(request, principal, ioi.trainingId, ioiPartial, 'wa')

    const studentHeaders = workHeaders(student)
    const principalHeaders = workHeaders(principal)
    const icpcRank = await (await request.get(`/api/trainings/${icpc.trainingId}/ranking`, { headers: studentHeaders })).json()
    const icpcRow = icpcRank.data.ranking.find((row: any) => row.userId === student.userId)
    expect(icpcRank.data.format).toBe('icpc')
    expect(icpcRow).toMatchObject({ solvedCount: 1, totalPenalty: 20 })
    expect(icpcRow.problems[icpc.trainingProblemId]).toMatchObject({ solved: true, attempts: 2 })

    const ioiRank = await (await request.get(`/api/trainings/${ioi.trainingId}/ranking`, { headers: studentHeaders })).json()
    expect(ioiRank.data.format).toBe('ioi')
    expect(ioiRank.data.ranking.find((row: any) => row.userId === student.userId).totalScore).toBe(40)

    const oiHiddenRank = await (await request.get(`/api/trainings/${oi.trainingId}/ranking`, { headers: studentHeaders })).json()
    expect(oiHiddenRank.data).toMatchObject({ format: 'oi', hidden: true, ranking: [] })
    const oiAdminRank = await (await request.get(`/api/trainings/${oi.trainingId}/ranking`, { headers: principalHeaders })).json()
    expect(oiAdminRank.data.ranking.find((row: any) => row.userId === student.userId).totalScore).toBe(40)
    const oiHiddenList = await (await request.get(`/api/trainings/${oi.trainingId}/submissions`, { headers: studentHeaders })).json()
    expect(oiHiddenList.data.submissions[0]).toMatchObject({ result: 'submitted', score: null, timeUsed: null, memoryUsed: null })

    const icpcDetail = await (await request.get(`/api/trainings/${icpc.trainingId}/submissions/${icpcAccepted}`, { headers: studentHeaders })).json()
    expect(icpcDetail.data).toMatchObject({ judgeMode: 'acm', result: 'accepted', score: 100 })
    const ioiDetail = await (await request.get(`/api/trainings/${ioi.trainingId}/submissions/${ioiPartial}`, { headers: studentHeaders })).json()
    expect(ioiDetail.data).toMatchObject({ judgeMode: 'oi', result: 'wa', score: 40 })
    expect(ioiDetail.data.subtasks[0]).toMatchObject({ id: 1, type: 'sum', score: 40 })

    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const studentPage = await studentContext.newPage()
    await studentPage.goto(`${organizationBase}/contests/${icpc.trainingId}?tab=ranking`)
    await expect(studentPage.getByRole('table', { name: '比赛排名' })).toHaveAttribute('data-ranking-format', 'icpc')
    await expect(studentPage.getByRole('columnheader', { name: '罚时' })).toBeVisible()
    await studentPage.goto(`${organizationBase}/contests/${ioi.trainingId}?tab=ranking`)
    await expect(studentPage.getByRole('table', { name: '比赛排名' })).toHaveAttribute('data-ranking-format', 'ioi')
    await expect(studentPage.getByRole('columnheader', { name: '总分' })).toBeVisible()
    await studentPage.goto(`${organizationBase}/contests/${oi.trainingId}?tab=ranking`)
    await expect(studentPage.getByText('排名暂不可见')).toBeVisible()

    for (const contest of contests) {
      const finished = await request.post(`/api/trainings/${contest.trainingId}/finish`, { headers: principalHeaders })
      expect(finished.status()).toBe(200)
    }

    const oiVisibleRank = await (await request.get(`/api/trainings/${oi.trainingId}/ranking`, { headers: studentHeaders })).json()
    expect(oiVisibleRank.data.hidden).toBeFalsy()
    expect(oiVisibleRank.data.ranking.find((row: any) => row.userId === student.userId).totalScore).toBe(40)
    const oiVisibleDetail = await (await request.get(`/api/trainings/${oi.trainingId}/submissions/${oiPartial}`, { headers: studentHeaders })).json()
    expect(oiVisibleDetail.data).toMatchObject({ judgeMode: 'oi', result: 'wa', score: 40 })
    expect(oiVisibleDetail.data.cases).toHaveLength(1)

    await studentPage.reload()
    await expect(studentPage.getByRole('table', { name: '比赛排名' })).toHaveAttribute('data-ranking-format', 'oi')
    await expect(studentPage.getByRole('cell', { name: '40' }).first()).toBeVisible()
    await studentContext.close()
  } finally {
    if (!restoredAcm) await setJudgeMode(request, platformAdmin, 'acm').catch(() => {})
    for (const contest of contests.reverse()) {
      await request.delete(`/api/trainings/${contest.trainingId}`, { headers: workHeaders(principal) }).catch(() => {})
    }
  }
})
