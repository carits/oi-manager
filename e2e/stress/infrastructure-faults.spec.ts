import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { bearer, loginAs } from '../fixtures/api'

const databaseUrl = process.env.E2E_DATABASE_URL!
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const resultDir = path.resolve('test-results/stress')

async function submit(request: APIRequestContext, token: string, code: string) {
  const response = await request.post('/api/submit', {
    headers: { Authorization: `Bearer ${token}` },
    data: { problemId: 'E2E-1000', oj: 'carits', language: 'cpp', code, submitMethod: 'local' },
  })
  const body = await response.json()
  expect(response.status(), JSON.stringify(body)).toBe(200)
  return Number(body.data.submissionId)
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
  expect((await request.get('/api/readiness', { headers: bearer(student) })).status()).toBe(200)
})
