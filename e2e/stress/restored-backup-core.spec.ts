import { expect, test, type APIRequestContext } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { bearer, loginAs } from '../fixtures/api'

const e2eUrl = process.env.E2E_DATABASE_URL!
const restoredUrl = process.env.RESTORED_DATABASE_URL!
const prisma = new PrismaClient({ datasources: { db: { url: e2eUrl } } })
const restored = new PrismaClient({ datasources: { db: { url: restoredUrl } } })

async function submit(request: APIRequestContext, token: string, code: string) {
  const response = await request.post('/api/submit', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      problemId: 'E2E-1000',
      oj: 'carits',
      language: 'cpp',
      code,
      submitMethod: 'local',
    },
  })
  const body = await response.json()
  expect(response.status(), JSON.stringify(body)).toBe(200)
  return Number(body.data.submissionId)
}

async function waitForSubmission(id: number, result: string) {
  await expect.poll(async () => {
    const item = await prisma.submission.findUniqueOrThrow({ where: { id } })
    return item.result
  }, { intervals: [100, 250, 500, 1000], timeout: 120_000 }).toBe(result)
  return prisma.submission.findUniqueOrThrow({ where: { id } })
}

test.afterAll(async () => {
  await Promise.all([prisma.$disconnect(), restored.$disconnect()])
})

test('restored production snapshot has usable business and Revision data', async () => {
  const [users, problems, trainings, submissions, revisions, pinnedActivities] = await Promise.all([
    restored.user.count(),
    restored.problem.count(),
    restored.training.count(),
    restored.submission.count(),
    restored.problemTestSetRevision.count(),
    restored.trainingProblem.count({ where: { testSetRevisionId: { not: null } } }),
  ])

  expect(users).toBeGreaterThan(20_000)
  expect(problems).toBeGreaterThan(0)
  expect(trainings).toBeGreaterThan(0)
  expect(submissions).toBeGreaterThan(0)
  expect(revisions).toBeGreaterThan(0)
  expect(pinnedActivities).toBeGreaterThan(0)

  const latest = await restored.problem.findMany({
    where: { latestTestSetRevisionId: { not: null } },
    select: {
      id: true,
      latestTestSetRevisionId: true,
      LatestTestSetRevision: { select: { problemId: true, judgeConfig: true, judgeConfigHash: true, graphHash: true } },
    },
  })
  expect(latest.length).toBeGreaterThan(0)
  for (const problem of latest) {
    expect(problem.LatestTestSetRevision?.problemId).toBe(problem.id)
    expect(problem.LatestTestSetRevision?.judgeConfig).toBeTruthy()
    expect(problem.LatestTestSetRevision?.judgeConfigHash).toMatch(/^[a-f0-9]{64}$/)
    expect(problem.LatestTestSetRevision?.graphHash).toMatch(/^[a-f0-9]{64}$/)
  }
})

test('restored stack completes auth, real Judge, Hack promotion, and activity pinning', async ({ request }) => {
  const [superAdmin, platformAdmin, principal, student] = await Promise.all([
    loginAs(request, 'superAdmin'),
    loginAs(request, 'platformAdmin'),
    loginAs(request, 'principal'),
    loginAs(request, 'campusStudent'),
  ])
  expect(superAdmin.role).toBe('super_admin')
  expect(platformAdmin.role).toBe('platform_admin')
  expect(principal.role).toBe('school_principal')
  expect(student.role).toBe('student')

  for (const session of [superAdmin, platformAdmin]) {
    const workspaces = await request.get('/api/workspaces', { headers: bearer(session) })
    expect(workspaces.status()).toBe(200)
    const body = await workspaces.json()
    expect(body.success).toBe(true)
    expect(body.data.workspaces).toHaveLength(1)
  }

  const acceptedId = await submit(
    request,
    student.token,
    '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
  )
  const accepted = await waitForSubmission(acceptedId, 'accepted')
  expect(accepted.score).toBe(100)
  expect(accepted.testSetRevisionId).toBeTruthy()
  const baseRevisionId = accepted.testSetRevisionId!

  const wrongId = await submit(request, student.token, '#include <iostream>\nint main(){std::cout<<0<<"\\n";}')
  const wrong = await waitForSubmission(wrongId, 'wa')
  expect(wrong.score).toBe(0)
  expect(wrong.testSetRevisionId).toBe(baseRevisionId)

  const principalHeaders = {
    ...bearer(principal),
    'x-oi-organization-id': 'org_school-default',
  }
  const futureStart = new Date(Date.now() + 30 * 60_000).toISOString()
  const futureEnd = new Date(Date.now() + 3 * 60 * 60_000).toISOString()
  const trainingIds: number[] = []
  const trainingProblemIds: string[] = []
  for (const suffix of ['manual-update', 'frozen']) {
    const create = await request.post('/api/teams/e2e-team/trainings', {
      headers: principalHeaders,
      data: {
        title: `Restore audit ${suffix}`,
        description: 'Isolated restored-backup verification',
        format: 'icpc',
        type: 'contest',
        startTime: futureStart,
        endTime: futureEnd,
        problemIdVisible: true,
      },
    })
    const createBody = await create.json()
    expect(create.status(), JSON.stringify(createBody)).toBe(200)
    const trainingId = Number(createBody.data.id)
    trainingIds.push(trainingId)

    const add = await request.post(`/api/trainings/${trainingId}/problems`, {
      headers: principalHeaders,
      data: { problemId: 'e2e-problem', alias: 'A', points: 100 },
    })
    const addBody = await add.json()
    expect(add.status(), JSON.stringify(addBody)).toBe(200)
    trainingProblemIds.push(String(addBody.data.id))
    expect(addBody.data.testSetRevisionId).toBe(baseRevisionId)
  }

  const configure = await request.put('/api/problems/e2e-problem/hack-config', {
    headers: bearer(platformAdmin),
    timeout: 150_000,
    data: {
      enabled: true,
      standardSource: '#include <iostream>\nint main(){long long a,b;if(std::cin>>a>>b)std::cout<<a+b<<"\\n";}',
      validatorSource: '#include <iostream>\n#include <string>\nint main(){long long a,b;std::string extra;if(!(std::cin>>a>>b))return 1;return (std::cin>>extra)?1:0;}',
    },
  })
  const configureBody = await configure.json()
  expect(configure.status(), JSON.stringify(configureBody)).toBe(200)
  expect(configureBody.data.enabled).toBe(true)

  const createHack = await request.post('/api/problems/e2e-problem/hacks', {
    headers: bearer(student),
    data: {
      inputMode: 'data',
      inputData: '2 2\n',
      hackLanguage: 'cpp17',
      hackSource: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;if(a==2&&b==2)std::cout<<0<<"\\n";else std::cout<<a+b<<"\\n";}',
    },
  })
  const hackBody = await createHack.json()
  expect(createHack.status(), JSON.stringify(hackBody)).toBe(202)
  const hackId = String(hackBody.data.id)

  await expect.poll(async () => {
    return (await prisma.problemHackAttempt.findUniqueOrThrow({ where: { id: hackId } })).status
  }, { intervals: [250, 500, 1000], timeout: 180_000 }).toBe('accepted')
  const hack = await prisma.problemHackAttempt.findUniqueOrThrow({ where: { id: hackId } })
  expect(hack.baselineResult).toBe('Accepted')
  expect(hack.candidateResult).toBe('Wrong Answer')
  expect(hack.canonicalStatus).toBe('promoted')
  expect(hack.promotedRevisionId).toBeTruthy()

  const problem = await prisma.problem.findUniqueOrThrow({ where: { id: 'e2e-problem' } })
  expect(problem.latestTestSetRevisionId).toBe(hack.promotedRevisionId)
  expect(problem.latestTestSetRevisionId).not.toBe(baseRevisionId)
  expect((await prisma.submission.findUniqueOrThrow({ where: { id: acceptedId } })).testSetRevisionId)
    .toBe(baseRevisionId)

  const pinnedBeforeUpdate = await prisma.trainingProblem.findMany({
    where: { id: { in: trainingProblemIds } },
    orderBy: { id: 'asc' },
  })
  expect(pinnedBeforeUpdate.every(item => item.testSetRevisionId === baseRevisionId)).toBe(true)

  const preview = await request.get(
    `/api/trainings/${trainingIds[0]}/problems/${trainingProblemIds[0]}/test-set-update`,
    { headers: principalHeaders },
  )
  const previewBody = await preview.json()
  expect(preview.status(), JSON.stringify(previewBody)).toBe(200)
  expect(previewBody.data).toMatchObject({ pending: true, frozen: false })

  const update = await request.post(
    `/api/trainings/${trainingIds[0]}/problems/${trainingProblemIds[0]}/test-set-update`,
    { headers: principalHeaders, data: {} },
  )
  const updateBody = await update.json()
  expect(update.status(), JSON.stringify(updateBody)).toBe(200)
  expect(updateBody.data.currentRevisionId).toBe(problem.latestTestSetRevisionId)

  const start = await request.post(`/api/trainings/${trainingIds[1]}/start`, { headers: principalHeaders })
  expect(start.status()).toBe(200)
  const frozenUpdate = await request.post(
    `/api/trainings/${trainingIds[1]}/problems/${trainingProblemIds[1]}/test-set-update`,
    { headers: principalHeaders, data: {} },
  )
  const frozenBody = await frozenUpdate.json()
  expect(frozenUpdate.status(), JSON.stringify(frozenBody)).toBe(409)
  expect(frozenBody.code).toBe('TEST_SET_REVISION_FROZEN')
  expect((await prisma.trainingProblem.findUniqueOrThrow({ where: { id: trainingProblemIds[1] } })).testSetRevisionId)
    .toBe(baseRevisionId)

  const acceptedAfterId = await submit(
    request,
    student.token,
    '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
  )
  const acceptedAfter = await waitForSubmission(acceptedAfterId, 'accepted')
  expect(acceptedAfter.testSetRevisionId).toBe(problem.latestTestSetRevisionId)

  const hackedAfterId = await submit(
    request,
    student.token,
    '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;if(a==2&&b==2)std::cout<<0<<"\\n";else std::cout<<a+b<<"\\n";}',
  )
  const hackedAfter = await waitForSubmission(hackedAfterId, 'wa')
  expect(hackedAfter.testSetRevisionId).toBe(problem.latestTestSetRevisionId)
  expect(await prisma.submission.count({ where: { result: { in: ['queuing', 'judging', 'finalizing'] } } })).toBe(0)
})
