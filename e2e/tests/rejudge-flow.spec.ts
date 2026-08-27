import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { bearer, loginAs } from '../fixtures/api'
import { loadFixtureIds } from '../fixtures/data'
import { persistOwnedSubmissionResult } from '../../apps/server/src/ws/judge'

const ids = loadFixtureIds()
const problemId = 'e2e-contest-problem-b'
const databaseUrl = process.env.E2E_DATABASE_URL
  || 'postgresql://oi:oi_password@127.0.0.1:5432/oi_manager?schema=e2e'
if (new URL(databaseUrl).searchParams.get('schema') !== 'e2e') {
  throw new Error('Rejudge concurrency test requires schema=e2e')
}
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const organizationHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'X-OI-Organization-ID': `org_${ids.school}`,
})

test.afterAll(async () => prisma.$disconnect())

test('contest rejudge is scoped, skips active work and excludes archives', async ({ request }) => {
  const principal = await loginAs(request, 'principal')
  const student = await loginAs(request, 'campusStudent')
  const principalHeaders = organizationHeaders(principal.token)
  const studentHeaders = organizationHeaders(student.token)
  const previewUrl = `/api/trainings/${ids.contest}/rejudge/preview?scopeType=problem&trainingProblemId=${problemId}`

  const before = await request.get(previewUrl, { headers: principalHeaders })
  expect(before.status()).toBe(200)
  expect((await before.json()).data).toEqual({ matchedCount: 3, inProgressCount: 0 })

  const forbidden = await request.post(`/api/trainings/${ids.contest}/rejudge`, {
    headers: studentHeaders,
    data: { scope: { type: 'problem', trainingProblemId: problemId } },
  })
  expect(forbidden.status()).toBe(403)

  const rejudge = await request.post(`/api/trainings/${ids.contest}/rejudge`, {
    headers: principalHeaders,
    data: { scope: { type: 'problem', trainingProblemId: problemId } },
  })
  expect(rejudge.status()).toBe(200)
  expect((await rejudge.json()).data).toMatchObject({ resetCount: 3, skippedCount: 0, scope: 'problem' })

  const after = await request.get(previewUrl, { headers: principalHeaders })
  expect(after.status()).toBe(200)
  expect((await after.json()).data).toEqual({ matchedCount: 0, inProgressCount: 3 })

  const repeated = await request.post(`/api/trainings/${ids.contest}/rejudge`, {
    headers: principalHeaders,
    data: { scope: { type: 'problem', trainingProblemId: problemId } },
  })
  expect(repeated.status()).toBe(200)
  expect((await repeated.json()).data).toMatchObject({ resetCount: 0, skippedCount: 3 })

  const records = await request.get(`/api/trainings/${ids.contest}/submissions?problemId=${problemId}&pageSize=50`, {
    headers: principalHeaders,
  })
  expect(records.status()).toBe(200)
  const submissions = (await records.json()).data.submissions as Array<{ oj: string; result: string }>
  expect(submissions).toHaveLength(4)
  expect(submissions.filter(item => item.oj === 'carits').map(item => item.result)).toEqual([
    'queuing',
    'queuing',
    'queuing',
  ])
  expect(submissions.find(item => item.oj === 'codeforces')?.result).toBe('accepted')

  const otherProblem = await request.get(`/api/trainings/${ids.contest}/submissions?problemId=e2e-contest-problem&pageSize=50`, {
    headers: principalHeaders,
  })
  expect(otherProblem.status()).toBe(200)
  expect((await otherProblem.json()).data.submissions.every((item: { result: string }) => item.result === 'accepted')).toBe(true)

  const localRows = await prisma.submission.findMany({
    where: { trainingId: Number(ids.contest), trainingProblemId: problemId, submitMethod: 'local' },
    select: { id: true },
  })
  expect(localRows).toHaveLength(3)
  await prisma.submission.updateMany({
    where: { id: { in: localRows.map(item => item.id) } },
    data: { result: 'accepted', score: 100, judgeId: null, judgeStarted: null },
  })
  const trainingProblem = await prisma.trainingProblem.findUniqueOrThrow({
    where: { id: problemId },
    select: { problemId: true },
  })
  const input = '1 2\n'
  const output = '3\n'
  const judgeConfig = JSON.stringify({
    mode: 'acm',
    type: 'default',
    time: '1000ms',
    memory: '256MB',
    cases: [{ input: 'rejudge-race.in', output: 'rejudge-race.out' }],
  })
  const testdataDir = path.join(process.env.TESTDATA_DIR!, trainingProblem.problemId)
  fs.mkdirSync(testdataDir, { recursive: true })
  fs.writeFileSync(path.join(testdataDir, 'rejudge-race.in'), input)
  fs.writeFileSync(path.join(testdataDir, 'rejudge-race.out'), output)
  await prisma.testdataFile.createMany({
    data: [
      {
        id: 'e2e-rejudge-race-input',
        problemId: trainingProblem.problemId,
        filename: 'rejudge-race.in',
        size: Buffer.byteLength(input),
        md5: crypto.createHash('md5').update(input).digest('hex'),
        sha256: crypto.createHash('sha256').update(input).digest('hex'),
      },
      {
        id: 'e2e-rejudge-race-output',
        problemId: trainingProblem.problemId,
        filename: 'rejudge-race.out',
        size: Buffer.byteLength(output),
        md5: crypto.createHash('md5').update(output).digest('hex'),
        sha256: crypto.createHash('sha256').update(output).digest('hex'),
      },
    ],
  })
  await prisma.problem.update({ where: { id: trainingProblem.problemId }, data: { judgeConfig } })
  await prisma.trainingProblem.update({ where: { id: problemId }, data: { judgeConfigSnapshot: judgeConfig } })
  await prisma.training.update({
    where: { id: Number(ids.contest) },
    data: {
      startTime: new Date(Date.now() - 60_000),
      endTime: new Date(Date.now() + 60 * 60_000),
    },
  })

  const concurrentRejudges = Array.from({ length: 20 }, () => request.post(`/api/trainings/${ids.contest}/rejudge`, {
    headers: principalHeaders,
    data: { scope: { type: 'problem', trainingProblemId: problemId } },
  }))
  const normalSubmit = request.post(`/api/trainings/${ids.contest}/submit`, {
    headers: {
      ...studentHeaders,
      'Idempotency-Key': `rejudge-race-${Date.now()}`,
    },
    data: {
      trainingProblemId: problemId,
      language: 'cpp',
      code: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}',
      submitMethod: 'local',
    },
  })
  const [submitResponse, ...rejudgeResponses] = await Promise.all([normalSubmit, ...concurrentRejudges])
  expect(submitResponse.status(), await submitResponse.text()).toBe(200)
  const summaries = await Promise.all(rejudgeResponses.map(async response => {
    expect(response.status()).toBe(200)
    return (await response.json()).data as { resetCount: number; skippedCount: number }
  }))
  expect(summaries.reduce((sum, item) => sum + item.resetCount, 0)).toBe(3)
  expect(summaries.every(item => item.resetCount + item.skippedCount >= 3 && item.resetCount + item.skippedCount <= 4)).toBe(true)

  const afterRace = await prisma.submission.findMany({
    where: { trainingId: Number(ids.contest), trainingProblemId: problemId, submitMethod: 'local' },
    orderBy: { id: 'asc' },
  })
  expect(afterRace).toHaveLength(4)
  expect(afterRace.every(item => item.result === 'queuing' && item.judgeId === null)).toBe(true)

  const judged = afterRace[0]
  await prisma.submission.update({
    where: { id: judged.id },
    data: { result: 'judging', judgeId: 'rejudge-race-judge', judgeStarted: new Date(), score: null },
  })
  const [claimed, racingRejudge] = await Promise.all([
    persistOwnedSubmissionResult({
      submissionId: judged.id,
      result: 'Accepted',
      time: 2,
      wallTime: 3,
      memory: 1024,
      score: 100,
      cases: [],
    }, 'rejudge-race-judge'),
    request.post(`/api/trainings/${ids.contest}/rejudge`, {
      headers: principalHeaders,
      data: { scope: { type: 'problem', trainingProblemId: problemId } },
    }),
  ])
  expect(claimed).toBe(true)
  expect(racingRejudge.status()).toBe(200)
  const racingSummary = (await racingRejudge.json()).data as { resetCount: number; skippedCount: number }
  expect(racingSummary.resetCount + racingSummary.skippedCount).toBe(4)

  const final = await prisma.submission.findUniqueOrThrow({ where: { id: judged.id } })
  expect(['accepted', 'queuing']).toContain(final.result)
  expect(final.judgeId).toBeNull()
  expect(final.judgeStarted).toBeNull()
  if (final.result === 'accepted') expect(final.score).toBe(100)
  else expect(final.score).toBeNull()
  expect(await persistOwnedSubmissionResult({ submissionId: judged.id, result: 'Wrong Answer', score: 0 }, 'rejudge-race-judge')).toBe(false)
  expect((await prisma.submission.findUniqueOrThrow({ where: { id: judged.id } })).result).toBe(final.result)
})
