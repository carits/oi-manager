import { expect, test, type APIRequestContext } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { sessionCookie, loginAs } from '../fixtures/api'

const e2eUrl = process.env.E2E_DATABASE_URL!
const restoredUrl = process.env.RESTORED_DATABASE_URL!
const prisma = new PrismaClient({ datasources: { db: { url: e2eUrl } } })
const restored = new PrismaClient({ datasources: { db: { url: restoredUrl } } })

async function submit(request: APIRequestContext, cookie: string, code: string) {
  const response = await request.post('/api/submit', {
    headers: { Cookie: cookie },
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
    const item = await prisma.submission.findUniqueOrThrow({
      where: { id },
      include: { CurrentJudgeRun: true },
    })
    return item.CurrentJudgeRun?.result ?? item.result
  }, { intervals: [100, 250, 500, 1000], timeout: 120_000 }).toBe(result)
  const item = await prisma.submission.findUniqueOrThrow({
    where: { id },
    include: { CurrentJudgeRun: true },
  })
  return {
    ...item,
    result: item.CurrentJudgeRun?.result ?? item.result,
    score: item.CurrentJudgeRun?.score ?? item.score,
  }
}

async function waitForProgramVerification(
  request: APIRequestContext,
  headers: Record<string, string>,
  problemId: string,
  programId: string,
  versionId: string,
  jobId: string,
) {
  let completed: any = null
  await expect.poll(async () => {
    const response = await request.get(
      `/api/problems/${problemId}/judge-programs/${programId}/versions/${versionId}/verification`,
      { headers },
    )
    const body = await response.json()
    expect(response.status(), JSON.stringify(body)).toBe(200)
    completed = body.data.find((item: any) => item.id === jobId) || null
    return completed?.status || 'missing'
  }, { intervals: [250, 500, 1000], timeout: 180_000 }).toMatch(/^(completed|failed|cancelled)$/)
  expect(completed?.status, JSON.stringify(completed)).toBe('completed')
}

async function createAndActivateProgram(
  request: APIRequestContext,
  cookie: string,
  problemId: string,
  definition: Record<string, unknown>,
) {
  const headers = { Cookie: cookie }
  const create = await request.post(`/api/problems/${problemId}/judge-programs`, {
    headers,
    data: definition,
  })
  const createBody = await create.json()
  expect(create.status(), JSON.stringify(createBody)).toBe(201)
  const programId = String(createBody.data.program.id)
  const versionId = String(createBody.data.version.id)

  const compile = await request.post(
    `/api/problems/${problemId}/judge-programs/${programId}/versions/${versionId}/compile`,
    { headers, data: {} },
  )
  const compileBody = await compile.json()
  expect(compile.status(), JSON.stringify(compileBody)).toBe(202)
  await waitForProgramVerification(request, headers, problemId, programId, versionId, String(compileBody.data.id))

  const preflight = await request.post(
    `/api/problems/${problemId}/judge-programs/${programId}/versions/${versionId}/preflight`,
    { headers, data: {} },
  )
  const preflightBody = await preflight.json()
  expect(preflight.status(), JSON.stringify(preflightBody)).toBe(202)
  await waitForProgramVerification(request, headers, problemId, programId, versionId, String(preflightBody.data.id))

  const activate = await request.patch(`/api/problems/${problemId}/judge-programs/${programId}`, {
    headers,
    data: { currentVersionId: versionId },
  })
  const activateBody = await activate.json()
  expect(activate.status(), JSON.stringify(activateBody)).toBe(200)
  return { programId, versionId }
}

test.afterAll(async () => {
  await Promise.all([prisma.$disconnect(), restored.$disconnect()])
})

test('restored production snapshot has usable business data and at most two current TestSet slots', async () => {
  const [users, problems, contests, submissions, slots] = await Promise.all([
    restored.user.count(),
    restored.problem.count(),
    restored.contest.count(),
    restored.submission.count(),
    restored.problemTestSetSlot.findMany({ orderBy: [{ problemId: 'asc' }, { slot: 'asc' }] }),
  ])

  expect(users).toBeGreaterThan(20_000)
  expect(problems).toBeGreaterThan(0)
  expect(contests).toBeGreaterThan(0)
  expect(submissions).toBeGreaterThan(0)
  expect(slots.length).toBeGreaterThan(0)

  const byProblem = new Map<string, typeof slots>()
  for (const slot of slots) {
    const current = byProblem.get(slot.problemId) || []
    current.push(slot)
    byProblem.set(slot.problemId, current)
    expect(['STABLE', 'EVOLVING']).toContain(slot.slot)
    expect(slot.judgeConfig).toBeTruthy()
    expect(slot.judgeConfigHash).toMatch(/^[a-f0-9]{64}$/)
    expect(slot.graphHash).toMatch(/^[a-f0-9]{64}$/)
  }
  for (const current of byProblem.values()) {
    expect(current.length).toBeLessThanOrEqual(2)
    expect(new Set(current.map(item => item.slot)).size).toBe(current.length)
  }
  const legacyTable = await restored.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public."ProblemTestSetRevision"')::text AS name`
  expect(legacyTable[0]?.name).toBeNull()
})

test('restored stack completes auth, real Judge, Hack promotion, and activity pinning', async ({ request }) => {
  const [superAdmin, platformAdmin, principal, student] = await Promise.all([
    loginAs(request, 'superAdmin'),
    loginAs(request, 'platformAdmin'),
    loginAs(request, 'principal'),
    loginAs(request, 'campusStudent'),
  ])
  expect(superAdmin.accountRole).toBe('super_admin')
  expect(platformAdmin.accountRole).toBe('platform_admin')
  expect(principal.accountRole).toBe('user')
  expect(student.accountRole).toBe('user')

  for (const session of [superAdmin, platformAdmin]) {
    const workspaces = await request.get('/api/workspaces', { headers: sessionCookie(session) })
    expect(workspaces.status()).toBe(200)
    const body = await workspaces.json()
    expect(body.success).toBe(true)
    expect(body.data.workspaces).toHaveLength(1)
  }

  const acceptedId = await submit(
    request,
    student.cookie,
    '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
  )
  const accepted = await waitForSubmission(acceptedId, 'accepted')
  expect(accepted.score).toBe(100)
  expect(accepted.testSetSlot).toBe('STABLE')
  expect(accepted.testSetGraphHash).toBeTruthy()
  const baseStableGraphHash = accepted.testSetGraphHash!

  const wrongId = await submit(request, student.cookie, '#include <iostream>\nint main(){std::cout<<0<<"\\n";}')
  const wrong = await waitForSubmission(wrongId, 'wa')
  expect(wrong.score).toBe(0)
  expect(wrong.testSetSlot).toBe('STABLE')
  expect(wrong.testSetGraphHash).toBe(baseStableGraphHash)

  const principalHeaders = {
    ...sessionCookie(principal),
    'x-oi-organization-id': 'org_school-default',
  }
  const futureStart = new Date(Date.now() + 30 * 60_000).toISOString()
  const futureEnd = new Date(Date.now() + 3 * 60 * 60_000).toISOString()
  const contestIds: number[] = []
  const contestProblemIds: string[] = []
  for (const suffix of ['manual-update', 'frozen']) {
    const create = await request.post('/api/teams/e2e-team/contests', {
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
    const contestPublicId = Number(createBody.data.publicId ?? createBody.data.id)
    contestIds.push(contestPublicId)

    const add = await request.post(`/api/contests/${contestPublicId}/problems`, {
      headers: principalHeaders,
      data: { problemId: 'e2e-problem', alias: 'A', points: 100 },
    })
    const addBody = await add.json()
    expect(add.status(), JSON.stringify(addBody)).toBe(200)
    contestProblemIds.push(String(addBody.data.id))
    expect(addBody.data.testSetSlot).toBe('STABLE')
    expect(addBody.data.testSetGraphHash).toBe(baseStableGraphHash)
  }

  const standardSource = '#include <iostream>\nint main(){long long a,b;if(std::cin>>a>>b)std::cout<<a+b<<"\\n";}'
  const validatorSource = '#include <iostream>\n#include <string>\nint main(){long long a,b;std::string extra;if(!(std::cin>>a>>b))return 1;return (std::cin>>extra)?1:0;}'
  const standardProgram = await createAndActivateProgram(request, platformAdmin.cookie, 'e2e-problem', {
    kind: 'standard',
    name: 'Restored-backup STD probe',
    language: 'cpp17',
    protocol: 'oj.standard/v1',
    source: standardSource,
    fixtures: [{ name: 'sum', stdin: '1 2\n', expectedStdout: '3\n' }],
  })
  const validatorProgram = await createAndActivateProgram(request, platformAdmin.cookie, 'e2e-problem', {
    kind: 'validator',
    name: 'Restored-backup Validator probe',
    language: 'cpp17',
    protocol: 'oj.validator/v1',
    source: validatorSource,
    fixtures: [
      { name: 'valid', stdin: '1 2\n', expectedExitCode: 0 },
      { name: 'invalid', stdin: '1\n', expectedExitCode: 1 },
    ],
  })

  const configure = await request.put('/api/problems/e2e-problem/hack-config', {
    headers: sessionCookie(platformAdmin),
    timeout: 150_000,
    data: {
      enabled: true,
      standardProgramVersionId: standardProgram.versionId,
      validatorProgramVersionId: validatorProgram.versionId,
    },
  })
  const configureBody = await configure.json()
  expect(configure.status(), JSON.stringify(configureBody)).toBe(200)
  expect(configureBody.data.enabled).toBe(true)

  const createHack = await request.post('/api/problems/e2e-problem/hacks', {
    headers: sessionCookie(student),
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
  expect(hack.promotedGraphHash).toBeTruthy()

  const stableAfterHack = await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: 'e2e-problem', slot: 'STABLE' } } })
  const evolvingAfterHack = await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: 'e2e-problem', slot: 'EVOLVING' } } })
  expect(stableAfterHack.graphHash).toBe(baseStableGraphHash)
  expect(evolvingAfterHack.graphHash).toBe(hack.promotedGraphHash)
  expect(evolvingAfterHack.graphHash).not.toBe(baseStableGraphHash)
  expect((await prisma.submission.findUniqueOrThrow({ where: { id: acceptedId } })).testSetGraphHash).toBe(baseStableGraphHash)

  const contestProblems = await prisma.contestProblem.findMany({ where: { id: { in: contestProblemIds } }, orderBy: { id: 'asc' } })
  expect(contestProblems.every(item => item.testSetSlot === 'STABLE' && item.testSetGraphHash === baseStableGraphHash)).toBe(true)

  const acceptedAfterId = await submit(
    request,
    student.cookie,
    '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
  )
  const acceptedAfter = await waitForSubmission(acceptedAfterId, 'accepted')
  expect(acceptedAfter.testSetSlot).toBe('STABLE')
  expect(acceptedAfter.testSetGraphHash).toBe(baseStableGraphHash)

  const hackedAfterId = await submit(
    request,
    student.cookie,
    '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;if(a==2&&b==2)std::cout<<0<<"\\n";else std::cout<<a+b<<"\\n";}',
  )
  const hackedAfter = await waitForSubmission(hackedAfterId, 'accepted')
  expect(hackedAfter.testSetSlot).toBe('STABLE')
  expect(hackedAfter.testSetGraphHash).toBe(baseStableGraphHash)
  expect(await prisma.submission.count({
    where: { CurrentJudgeRun: { status: { in: ['QUEUED', 'RUNNING'] } } },
  })).toBe(0)
})
