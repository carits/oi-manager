import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import WebSocket from 'ws'
import { ensureInitialTestSetRevision } from '../../apps/server/src/modules/problem/problem.testset-revision.service'

const prisma = new PrismaClient()
const resultRoot = path.resolve('test-results/blue-green')

type Stack = {
  routerPort: number
  bluePort: number
  greenPort: number
  bluePid: number
  greenPid: number
  routerPid: number
  workerPid: number
  activeFile: string
  resultsDir: string
}

function resetHttpConnection(port: number): Promise<void> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const done = () => resolve()
    socket.once('error', done)
    socket.once('close', done)
    socket.once('connect', () => {
      socket.write('GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n')
      setImmediate(() => socket.resetAndDestroy())
    })
  })
}

function readStack(): Stack {
  return JSON.parse(fs.readFileSync(path.join(resultRoot, 'stack.json'), 'utf8'))
}

function setActive(file: string, port: number) {
  const next = `${file}.next-${process.pid}`
  fs.writeFileSync(next, `${port}\n`)
  fs.renameSync(next, file)
}

function connectJudge(url: string, judgeId: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url)
    const timeout = setTimeout(() => reject(new Error(`Judge ${judgeId} registration timed out`)), 10_000)
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', payload: { token: 'e2e-blue-green-token-20260827' } })))
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

function waitForClose(ws: WebSocket) {
  return new Promise<number>(resolve => ws.once('close', code => resolve(code)))
}

test.afterAll(async () => prisma.$disconnect())

test('two API processes finalize once, switch/rollback, drain Judge, and keep one Worker', async ({ request }) => {
  const stack = readStack()
  expect(Number(fs.readFileSync(path.join(resultRoot, 'worker-secondary.exit'), 'utf8').trim())).not.toBe(0)
  expect(fs.readFileSync(path.join(resultRoot, 'worker-secondary.log'), 'utf8')).toContain('Another background worker already holds the singleton lock')

  await Promise.all(Array.from({ length: 50 }, () => resetHttpConnection(stack.routerPort)))
  process.kill(stack.routerPid, 0)
  await expect.poll(async () => (await request.get('/api/health')).status()).toBe(200)

  const initialProblem = await prisma.problem.findUniqueOrThrow({ where: { id: 'e2e-problem' } })
  const revision = await ensureInitialTestSetRevision(initialProblem.id, 'e2e-campus-principal')
  const problem = await prisma.problem.findUniqueOrThrow({ where: { id: initialProblem.id } })
  expect(problem.latestTestSetRevisionId).toBe(revision.id)
  const batch = `blue-green-${Date.now()}`
  await prisma.submission.createMany({
    data: Array.from({ length: 100 }, (_, index) => ({
      userId: 'e2e-campus-student', oj: 'carits', problemId: 'E2E-1000', problemInternalId: problem.id,
      language: 'cpp', code: `int main(){return ${index};}`, codeLength: 22,
      result: 'judging', submitMethod: 'local', submitScope: 'problem', submitSource: batch,
      sourceId: `${batch}-${index}`, judgeId: 'dual-finalizer', judgeStarted: new Date(),
      testSetRevisionId: problem.latestTestSetRevisionId,
    })),
  })
  const submissions = await prisma.submission.findMany({ where: { submitSource: batch }, select: { id: true } })
  expect(submissions).toHaveLength(100)

  const [blueJudge, greenJudge] = await Promise.all([
    connectJudge(`ws://127.0.0.1:${stack.bluePort}/ws/judge`, 'dual-finalizer'),
    connectJudge(`ws://127.0.0.1:${stack.greenPort}/ws/judge`, 'dual-finalizer'),
  ])
  for (const submission of submissions) {
    const result = JSON.stringify({
      type: 'result', payload: { submissionId: submission.id, result: 'Accepted', time: 3, wallTime: 4, memory: 1024, score: 100, cases: [] },
    })
    blueJudge.send(result)
    greenJudge.send(result)
  }
  await expect.poll(() => prisma.submission.count({ where: { submitSource: batch, result: 'accepted' } })).toBe(100)
  expect(await prisma.submission.count({ where: { submitSource: batch, judgeId: { not: null } } })).toBe(0)
  blueJudge.send(JSON.stringify({ type: 'result', payload: { submissionId: submissions[0].id, result: 'Wrong Answer', score: 0 } }))
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(await prisma.submission.findUniqueOrThrow({ where: { id: submissions[0].id } })).toMatchObject({ result: 'accepted', score: 100 })
  blueJudge.close()
  greenJudge.close()

  process.kill(stack.workerPid, 'SIGTERM')
  await expect.poll(() => {
    try { process.kill(stack.workerPid, 0); return 'running' } catch { return 'stopped' }
  }).toBe('stopped')
  const replacementLog = path.join(resultRoot, 'worker-replacement.log')
  const replacementOutput = fs.openSync(replacementLog, 'w')
  const replacement = spawn('pnpm', ['exec', 'tsx', 'src/background-worker.ts'], {
    cwd: path.resolve('apps/server'),
    env: {
      ...process.env,
      NODE_ENV: 'test', APP_ENV: 'test',
      BACKGROUND_WORKER_LOCK_NAME: 'oi-manager-e2e-blue-green-worker',
    },
    stdio: ['ignore', replacementOutput, replacementOutput],
  })
  try {
    await expect.poll(() => fs.readFileSync(replacementLog, 'utf8')).toContain('background_worker_started')
    expect(await prisma.submission.count({ where: { submitSource: batch, result: 'accepted' } })).toBe(100)
  } finally {
    replacement.kill('SIGTERM')
    await new Promise<void>(resolve => replacement.once('exit', () => resolve()))
    fs.closeSync(replacementOutput)
  }

  const pinned = await connectJudge(`ws://127.0.0.1:${stack.routerPort}/ws/judge`, 'pinned-blue-probe')
  setActive(stack.activeFile, stack.greenPort)
  expect((await request.get('/api/readiness')).status()).toBe(200)
  const greenProbe = await connectJudge(`ws://127.0.0.1:${stack.routerPort}/ws/judge`, 'green-route-probe')
  await expect.poll(() => fs.readFileSync(path.join(resultRoot, 'server-green.log'), 'utf8')).toContain('green-route-probe')

  setActive(stack.activeFile, stack.bluePort)
  expect((await request.get('/api/readiness')).status()).toBe(200)
  const rollbackProbe = await connectJudge(`ws://127.0.0.1:${stack.routerPort}/ws/judge`, 'rollback-blue-probe')
  await expect.poll(() => fs.readFileSync(path.join(resultRoot, 'server-blue.log'), 'utf8')).toContain('rollback-blue-probe')
  rollbackProbe.close()

  setActive(stack.activeFile, stack.greenPort)
  const pinnedClose = waitForClose(pinned)
  process.kill(stack.bluePid, 'SIGUSR2')
  expect(await pinnedClose).toBe(1012)
  greenProbe.close()
  await expect.poll(() => (fs.readFileSync(path.join(resultRoot, 'judge.log'), 'utf8').match(/Registration confirmed/g) || []).length, {
    timeout: 30_000,
  }).toBeGreaterThanOrEqual(2)
  expect((await request.get('/api/readiness')).status()).toBe(200)
  expect(fs.readFileSync(stack.activeFile, 'utf8').trim()).toBe(String(stack.greenPort))
})
