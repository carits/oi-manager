import fs from 'node:fs'
import crypto from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import WebSocket from 'ws'
import { ensureInitialTestSetSlots } from '../../apps/server/src/modules/problem/problem.testset-slot.service'
import { createQueuedSubmissionWithRun } from '../../apps/server/src/modules/judge/application/judge-run.service'

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

function connectJudge(
  url: string,
  judgeId: string,
  onTask?: (payload: any, ws: WebSocket) => void,
) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url)
    const timeout = setTimeout(
      () => reject(new Error(`Judge ${judgeId} registration timed out`)),
      10_000,
    )
    ws.on('open', () => ws.send(JSON.stringify({
      type: 'auth',
      payload: { token: 'e2e-blue-green-token-20260827' },
    })))
    ws.on('message', data => {
      const message = JSON.parse(data.toString())
      if (message.type === 'auth_success') {
        ws.send(JSON.stringify({
          type: 'register',
          payload: { judgeId, languages: ['cpp17'] },
        }))
      } else if (message.type === 'registered') {
        clearTimeout(timeout)
        ws.send(JSON.stringify({
          type: 'start',
          payload: { judgeId, concurrency: 8 },
        }))
        resolve(ws)
      } else if (message.type === 'judge') {
        onTask?.(message.payload, ws)
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
  const initialSlots = await ensureInitialTestSetSlots(initialProblem.id, 'e2e-campus-principal')
  const stable = initialSlots.find(item => item.slot === 'STABLE')
  expect(stable).toBeTruthy()
  const problem = await prisma.problem.findUniqueOrThrow({ where: { id: initialProblem.id } })
  const batch = `blue-green-${Date.now()}`
  for (const index of Array.from({ length: 100 }, (_, value) => value)) {
    await createQueuedSubmissionWithRun({
      userId: 'e2e-campus-student', oj: 'carits', problemId: 'E2E-1000', problemInternalId: problem.id,
      workspaceScope: 'campus', organizationId: 'org_school-default',
      language: 'cpp', code: `int main(){return ${index};}`, codeLength: 22,
      submitMethod: 'local', submitScope: 'problem', submitSource: batch,
      sourceId: `${batch}-${index}`, testSetSlot: 'STABLE',
      ioAdapterVersion: 0, inputFilename: null, outputFilename: null,
    })
  }
  const submissions = await prisma.submission.findMany({ where: { submitSource: batch }, select: { id: true } })
  expect(submissions).toHaveLength(100)

  let firstLifecycle: {
    judgeRunId: string
    judgeAttemptId: string
    fencingToken: string
    ws: WebSocket
  } | undefined
  const sendAccepted = (payload: any, ws: WebSocket) => {
    firstLifecycle ??= {
      judgeRunId: payload.judgeRunId,
      judgeAttemptId: payload.judgeAttemptId,
      fencingToken: payload.fencingToken,
      ws,
    }
    ws.send(JSON.stringify({
      type: 'result',
      payload: {
        submissionId: Number(payload.submissionId),
        judgeRunId: payload.judgeRunId,
        judgeAttemptId: payload.judgeAttemptId,
        fencingToken: payload.fencingToken,
        result: 'Accepted',
        time: 3,
        wallTime: 4,
        memory: 1024,
        score: 100,
        cases: [],
      },
    }))
  }
  const [blueJudge, greenJudge] = await Promise.all([
    connectJudge(`ws://127.0.0.1:${stack.bluePort}/ws/judge`, 'dual-finalizer', sendAccepted),
    connectJudge(`ws://127.0.0.1:${stack.greenPort}/ws/judge`, 'dual-finalizer', sendAccepted),
  ])
  await expect.poll(() => prisma.judgeRun.count({
    where: { Submission: { submitSource: batch }, result: 'accepted' },
  })).toBe(100)
  expect(firstLifecycle).toBeTruthy()
  firstLifecycle?.ws.send(JSON.stringify({
    type: 'result',
    payload: {
      submissionId: submissions[0].id,
      judgeRunId: firstLifecycle.judgeRunId,
      judgeAttemptId: firstLifecycle.judgeAttemptId,
      fencingToken: firstLifecycle.fencingToken,
      result: 'Wrong Answer',
      score: 0,
    },
  }))
  await new Promise(resolve => setTimeout(resolve, 300))
  expect(await prisma.judgeRun.findFirstOrThrow({ where: { submissionId: submissions[0].id } }))
    .toMatchObject({ result: 'accepted', score: 100 })
  blueJudge.close()
  greenJudge.close()

  await prisma.problem.update({ where: { id: problem.id }, data: { dataContributionEnabled: true } })
  await ensureInitialTestSetSlots(problem.id, 'e2e-campus-principal')
  const hackProblem = await prisma.problem.findUniqueOrThrow({
    where: { id: problem.id }, include: { TestSetSlots: true },
  })
  const evolving = hackProblem.TestSetSlots.find(item => item.slot === 'EVOLVING')
  expect(evolving).toBeTruthy()
  await prisma.problemHackConfig.upsert({
    where: { problemId: hackProblem.id },
    create: {
      id: crypto.randomUUID(), problemId: hackProblem.id, enabled: true, mode: 'acm',
      standardSource: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
      validatorSource: '#include <iostream>\nint main(){long long a,b;if(!(std::cin>>a>>b))return 1;std::string x;if(std::cin>>x)return 1;return 0;}',
      classifierSource: '', revision: 1, updatedBy: 'e2e-campus-principal',
    },
    update: { enabled: true, mode: 'acm', revision: 1, updatedBy: 'e2e-campus-principal' },
  })
  const hackAttemptId = crypto.randomUUID()
  const hackJudgeId = 'dual-hack-finalizer'
  await prisma.problemHackAttempt.create({ data: {
    id: hackAttemptId, problemId: hackProblem.id, userId: 'e2e-campus-student',
    status: 'judging', inputMode: 'data', inputData: '413 587\n',
    hackSource: 'int main(){return 0;}', hackLanguage: 'cpp17',
    hackConfigRevision: 1, judgeConfigHash: evolving!.judgeConfigHash,
    testGraphRevision: hackProblem.testGraphRevision,
    baseSlot: 'EVOLVING', baseGraphHash: evolving!.graphHash, baseFencingToken: evolving!.fencingToken,
    judgeId: hackJudgeId, judgeStarted: new Date(),
  } })
  const graphBeforeHack = evolving!.graphHash
  const [blueHackJudge, greenHackJudge] = await Promise.all([
    connectJudge(`ws://127.0.0.1:${stack.bluePort}/ws/judge`, hackJudgeId),
    connectJudge(`ws://127.0.0.1:${stack.greenPort}/ws/judge`, hackJudgeId),
  ])
  const hackResult = JSON.stringify({ type: 'hack_result', payload: {
    hackAttemptId, outcome: 'accepted', baselineResult: 'Accepted', baselineScore: 100,
    candidateResult: 'Wrong Answer', candidateScore: 0,
    inputData: '413 587\n', outputData: '1000\n', message: 'blue/green finalization probe',
  } })
  blueHackJudge.send(hackResult)
  greenHackJudge.send(hackResult)
  await expect.poll(async () => (await prisma.problemHackAttempt.findUniqueOrThrow({ where: { id: hackAttemptId } })).status,
    { timeout: 30_000 }).toBe('accepted')
  const promotedHack = await prisma.problemHackAttempt.findUniqueOrThrow({ where: { id: hackAttemptId } })
  expect(promotedHack).toMatchObject({ canonicalStatus: 'promoted', baselineResult: 'Accepted', candidateResult: 'Wrong Answer' })
  expect(promotedHack.promotedGraphHash).toBeTruthy()
  const evolvingAfterHack = await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: hackProblem.id, slot: 'EVOLVING' } } })
  expect(evolvingAfterHack.graphHash).toBe(promotedHack.promotedGraphHash)
  expect(evolvingAfterHack.graphHash).not.toBe(graphBeforeHack)
  expect(await prisma.problemTestcase.count({ where: { hackAttemptId } })).toBe(1)
  expect(await prisma.testdataFile.count({ where: { problemId: hackProblem.id, filename: { startsWith: `hack_${hackAttemptId}.` } } })).toBe(2)
  blueHackJudge.send(hackResult)
  greenHackJudge.send(hackResult)
  await new Promise(resolve => setTimeout(resolve, 300))
  expect((await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: hackProblem.id, slot: 'EVOLVING' } } })).graphHash).toBe(evolvingAfterHack.graphHash)
  blueHackJudge.close()
  greenHackJudge.close()

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
    expect(await prisma.judgeRun.count({ where: { Submission: { submitSource: batch }, result: 'accepted' } })).toBe(100)
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
