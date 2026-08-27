import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import WebSocket from 'ws'
import { bearer, loginAs } from '../fixtures/api'
import { loadRuntimeSecrets } from '../fixtures/runtime'

const databaseUrl = process.env.E2E_DATABASE_URL!
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const resultDir = path.resolve('test-results/stress')
const judgeToken = loadRuntimeSecrets().judgeToken

async function submit(request: APIRequestContext, token: string, code: string) {
  const response = await request.post('/api/submit', {
    headers: { Authorization: `Bearer ${token}` },
    data: { problemId: 'E2E-1000', oj: 'carits', language: 'cpp', code, submitMethod: 'local' },
  })
  const body = await response.json()
  expect(response.status(), JSON.stringify(body)).toBe(200)
  return Number(body.data.submissionId)
}

function connectJudge(url: string, judgeId: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url)
    const timeout = setTimeout(() => reject(new Error(`Judge ${judgeId} registration timed out`)), 10_000)
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', payload: { token: judgeToken } })))
    ws.on('message', data => {
      const message = JSON.parse(data.toString())
      if (message.type === 'auth_success') {
        ws.send(JSON.stringify({ type: 'register', payload: { judgeId, languages: ['cpp17'] } }))
      } else if (message.type === 'registered') {
        clearTimeout(timeout)
        resolve(ws)
      }
    })
    ws.on('error', reject)
  })
}

test.afterAll(async () => prisma.$disconnect())

test('sandbox and database interruptions retry without losing or mis-scoring submissions', async ({ request }) => {
  const student = await loginAs(request, 'campusStudent')
  const arm = await fetch('http://127.0.0.1:15052/__fault/next-reset', { method: 'POST' })
  expect(arm.status).toBe(204)
  const sandboxSubmission = await submit(request, student.token,
    '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}')
  await expect.poll(async () => (await prisma.submission.findUniqueOrThrow({ where: { id: sandboxSubmission } })).result,
    { intervals: [100, 250, 500, 1000], timeout: 90_000 }).toBe('accepted')
  expect(fs.readFileSync(path.join(resultDir, 'judge.log'), 'utf8')).toContain('Retryable infrastructure failure')
  expect(await prisma.submission.findUniqueOrThrow({ where: { id: sandboxSubmission } }))
    .toMatchObject({ result: 'accepted', score: 100, judgeId: null, judgeStarted: null })

  const problem = await prisma.problem.findUniqueOrThrow({ where: { id: 'e2e-problem' } })
  const config = JSON.stringify({ mode: 'acm', type: 'default', time: '5000ms', memory: '256MB',
    cases: [{ input: '1.in', output: '1.out' }] })
  await prisma.problem.update({ where: { id: problem.id }, data: { judgeConfig: config } })
  if (problem.latestTestSetRevisionId) {
    await prisma.problemTestSetRevision.update({ where: { id: problem.latestTestSetRevisionId }, data: { judgeConfig: config } })
  }
  const databaseSubmission = await submit(request, student.token,
    '#include <chrono>\n#include <iostream>\n#include <thread>\nint main(){int a,b;std::cin>>a>>b;std::this_thread::sleep_for(std::chrono::milliseconds(1800));std::cout<<a+b;}')
  await expect.poll(async () => (await prisma.submission.findUniqueOrThrow({ where: { id: databaseSubmission } })).result,
    { intervals: [50, 100, 200], timeout: 15_000 }).toBe('judging')
  const dropDatabase = await fetch('http://127.0.0.1:15434/__fault/drop?ms=3000', { method: 'POST' })
  expect(dropDatabase.status).toBe(204)

  await expect.poll(async () => {
    try {
      return (await prisma.submission.findUniqueOrThrow({ where: { id: databaseSubmission } })).result
    } catch {
      return 'database-unavailable'
    }
  },
    { intervals: [250, 500, 1000], timeout: 30_000 }).toBe('accepted')
  expect(await prisma.submission.findUniqueOrThrow({ where: { id: databaseSubmission } }))
    .toMatchObject({ result: 'accepted', score: 100, judgeId: null, judgeStarted: null })
  expect(fs.readFileSync(path.join(resultDir, 'server.log'), 'utf8')).toContain('judge_result_persistence_retry')
  const statuses = await prisma.submission.groupBy({
    by: ['result'], where: { id: { in: [sandboxSubmission, databaseSubmission] } }, _count: true,
  })
  expect(statuses).toEqual([{ result: 'accepted', _count: 2 }])

  const hackProblem = await prisma.problem.findUniqueOrThrow({
    where: { id: 'e2e-problem' }, include: { LatestTestSetRevision: true },
  })
  expect(hackProblem.LatestTestSetRevision).toBeTruthy()
  await prisma.problemHackConfig.upsert({
    where: { problemId: hackProblem.id },
    create: {
      id: crypto.randomUUID(), problemId: hackProblem.id, enabled: true, mode: 'acm',
      standardSource: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
      validatorSource: '#include <iostream>\nint main(){long long a,b;return(std::cin>>a>>b)?0:1;}',
      classifierSource: '', revision: 1, updatedBy: 'e2e-campus-principal',
    },
    update: { enabled: true, mode: 'acm', revision: 1, updatedBy: 'e2e-campus-principal' },
  })
  const faultHackId = crypto.randomUUID()
  const faultHackJudgeId = 'fault-hack-finalizer'
  await prisma.problemHackAttempt.create({ data: {
    id: faultHackId, problemId: hackProblem.id, userId: 'e2e-campus-student',
    status: 'judging', inputMode: 'data', inputData: '271 314\n',
    hackSource: 'int main(){return 0;}', hackLanguage: 'cpp17',
    hackConfigRevision: 1, judgeConfigHash: hackProblem.LatestTestSetRevision!.judgeConfigHash,
    testGraphRevision: hackProblem.testGraphRevision,
    baseTestSetRevisionId: hackProblem.latestTestSetRevisionId,
    judgeId: faultHackJudgeId, judgeStarted: new Date(),
  } })
  const revisionsBeforeHack = await prisma.problemTestSetRevision.count({ where: { problemId: hackProblem.id } })
  const faultHackJudge = await connectJudge('ws://127.0.0.1:3512/ws/judge', faultHackJudgeId)
  const dropHackDatabase = await fetch('http://127.0.0.1:15434/__fault/drop?ms=3000', { method: 'POST' })
  expect(dropHackDatabase.status).toBe(204)
  faultHackJudge.send(JSON.stringify({ type: 'hack_result', payload: {
    hackAttemptId: faultHackId, outcome: 'accepted',
    baselineResult: 'Accepted', baselineScore: 100,
    candidateResult: 'Wrong Answer', candidateScore: 0,
    inputData: '271 314\n', outputData: '585\n', message: 'database retry probe',
  } }))
  await expect.poll(async () => {
    try {
      return (await prisma.problemHackAttempt.findUniqueOrThrow({ where: { id: faultHackId } })).status
    } catch {
      return 'database-unavailable'
    }
  }, { intervals: [250, 500, 1000], timeout: 30_000 }).toBe('accepted')
  faultHackJudge.close()
  const faultHack = await prisma.problemHackAttempt.findUniqueOrThrow({ where: { id: faultHackId } })
  expect(faultHack).toMatchObject({ canonicalStatus: 'promoted', baselineResult: 'Accepted', candidateResult: 'Wrong Answer' })
  expect(faultHack.promotedRevisionId).toBeTruthy()
  expect(await prisma.problemTestSetRevision.count({ where: { problemId: hackProblem.id } })).toBe(revisionsBeforeHack + 1)
  expect(await prisma.problemTestcase.count({ where: { hackAttemptId: faultHackId } })).toBe(1)
  const problemFiles = fs.readdirSync(path.join(process.env.TESTDATA_DIR!, hackProblem.id))
  expect(problemFiles.filter(file => file.includes(faultHackId) && file.endsWith('.pending'))).toEqual([])
  expect(fs.readFileSync(path.join(resultDir, 'server.log'), 'utf8')).toContain(faultHackId)
  expect(fs.readFileSync(path.join(resultDir, 'server.log'), 'utf8')).toContain('judge_result_persistence_retry')
  expect((await request.get('/api/readiness', { headers: bearer(student) })).status()).toBe(200)
})
