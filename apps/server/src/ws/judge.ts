/**
 * WebSocket 评测机服务端
 *
 * 处理评测机连接，采用 Hydro 风格的持久化队列模式：
 * - 评测机主动消费 current JudgeAttempt（QUEUED → RUNNING）
 * - 支持动态并发调整（config 消息）
 * - 断连时精准恢复任务
 * - 心跳检测 + 超时扫描
 */

import { Router, Request, Response } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { prisma } from '../prisma'
import { logger } from '../lib/logger'
import { onSubmissionJudged } from '../lib/submission-sync'
import { normalizeResult } from '../lib/result-enum'
import path from 'path'
import yaml from 'js-yaml'
import { resolveSubmissionIoSnapshot } from '../modules/judge/domain/submission-io'
import { getHeartbeatAction } from './judge-protocol'
import { finalizeHackResult } from '../modules/problem/problem.hack.service'
import { transitionHackAttempt, transitionHackAttempts } from '../modules/problem/problem.hack-state'
import {
  claimNextQueuedSubmission,
  finalizeOwnedJudgeAttempt,
  recoverStaleJudgeAttempts,
  rejudgeSubmissionWithRun,
  retryOwnedJudgeAttempt,
} from '../modules/judge/application/judge-run.service'
import { claimDataGenerationJob, finalizeDataGenerationJob } from '../modules/problem/problem.data-generation.service'
import { claimJudgeProgramVerificationJob, finalizeJudgeProgramVerificationJob, recoverJudgeProgramVerificationJobs } from '../modules/problem/problem.judge-program.service'
import { judgeLaneForDispatch } from '../modules/judge/domain/judge-lane-policy'
import { claimCandidateEvaluationRun, finalizeCandidateEvaluationRun, recoverCandidateEvaluationRuns } from '../modules/problem/problem.candidate-evaluation.service'
import { claimQualityVerificationJob, finalizeQualityVerificationJob, recoverQualityVerificationJobs } from '../modules/problem/problem.quality.service'

// 简单的随机 ID 生成（替代 nanoid）
const generateId = () => Math.random().toString(36).substring(2, 10)

// 评测机连接信息
interface JudgeConnection {
  ws: WebSocket
  judgeId: string
  languages: string[]
  consumer: JudgeConsumer | null
}

// 连接的评测机
const judges = new Map<WebSocket, JudgeConnection>()
const judgeHeartbeats = new Map<WebSocket, number>()

let wss: WebSocketServer | null = null
let acceptingJudgeTasks = true

/**
 * JudgeConsumer 类：轮询 JudgeAttempt，分发任务到评测机
 */
class JudgeConsumer {
  consuming: boolean = false
  processing: Map<string, {
    taskType: 'submission' | 'hack' | 'data_generation' | 'candidate_evaluation' | 'judge_program_verification' | 'quality_evaluation_verification'
    id: string
    startTime: number
    judgeAttemptId?: string
    fencingToken?: string
  }> = new Map()
  concurrency: number = 1
  notify: ((value?: unknown) => void) | null = null
  ws: WebSocket
  judgeId: string
  laneCursor = 0

  constructor(ws: WebSocket, judgeId: string, concurrency: number = 1) {
    this.ws = ws
    this.judgeId = judgeId
    this.concurrency = concurrency
  }

  async consume() {
    while (this.consuming) {
      if (!acceptingJudgeTasks) {
        await new Promise(resolve => setTimeout(resolve, 100))
        continue
      }
      if (this.processing.size >= this.concurrency) {
        await new Promise(resolve => { this.notify = resolve })
        continue
      }

      // 从 Submission 表取任务（原子：查询 + 更新状态）
      const task = await this.fetchNextTask()
      if (!task) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        continue
      }

      const taskType: 'submission' | 'hack' | 'data_generation' | 'candidate_evaluation' | 'judge_program_verification' | 'quality_evaluation_verification' = task.taskType
      const taskId = task.taskType === 'hack' ? task.hackAttemptId : task.taskType === 'candidate_evaluation' ? task.runId : task.taskType === 'data_generation' || task.taskType === 'judge_program_verification' || task.taskType === 'quality_evaluation_verification' ? task.jobId : task.submissionId
      const taskKey = `${taskType}:${taskId}`
      const dispatchedAt = Date.now()
      this.processing.set(taskKey, {
        taskType,
        id: taskId,
        startTime: dispatchedAt,
        judgeAttemptId: 'judgeAttemptId' in task ? task.judgeAttemptId : undefined,
        fencingToken: 'fencingToken' in task ? task.fencingToken : undefined,
      })

      logger.info('consumer_task_dispatched', {
        action: 'judge_consumer',
        metadata: { judgeId: this.judgeId, taskType, taskId, processingSize: this.processing.size }
      })

      // 发送任务到评测机
      this.ws.send(JSON.stringify({
        type: taskType === 'hack' ? 'hack' : taskType === 'data_generation' ? 'data_generation' : taskType === 'candidate_evaluation' ? 'candidate_evaluation' : taskType === 'judge_program_verification' ? 'judge_program_verification' : taskType === 'quality_evaluation_verification' ? 'quality_evaluation_verification' : 'judge',
        payload: taskType === 'submission' ? { ...task, dispatchedAt } : task
      }))
    }
  }

  async fetchNextTask(): Promise<DispatchTask | null> {
    const preferred = judgeLaneForDispatch(this.laneCursor)
    this.laneCursor = (this.laneCursor + 1) % 10
    const lanes = [preferred, ...['submission', 'hack', 'generation'].filter(lane => lane !== preferred)]
    for (const lane of lanes) {
      const task = lane === 'submission'
        ? await this.fetchNextSubmissionTask()
        : lane === 'hack'
          ? await this.fetchNextHackTask()
          : await claimQualityVerificationJob(this.judgeId) || await claimJudgeProgramVerificationJob(this.judgeId) || await claimDataGenerationJob(this.judgeId) || await claimCandidateEvaluationRun(this.judgeId)
      if (task) return task
    }
    return null
  }

  async fetchNextSubmissionTask(): Promise<JudgeTask | null> {
    let claimed: Awaited<ReturnType<typeof claimNextQueuedSubmission>> = null
    try {
      claimed = await claimNextQueuedSubmission(this.judgeId)
      if (!claimed) return null
      const problem = await prisma.problem.findUnique({
        where: { id: claimed.problemInternalId },
        select: { judgeConfig: true, latestTestSetRevisionId: true },
      })
      const trainingProblem = claimed.trainingProblemId
        ? await prisma.trainingProblem.findUnique({
            where: { id: claimed.trainingProblemId },
            select: { judgeConfigSnapshot: true, testSetRevisionId: true },
          })
        : null
      const revisionId = claimed.testSetRevisionId || trainingProblem?.testSetRevisionId || problem?.latestTestSetRevisionId
      const revision = revisionId
        ? await prisma.problemTestSetRevision.findFirst({
            where: { id: revisionId, problemId: claimed.problemInternalId },
            select: { judgeConfig: true, testdataPath: true },
          })
        : null
      const testdataRoot = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')
      const config = yaml.load(claimed.judgeConfigSnapshot || revision?.judgeConfig || trainingProblem?.judgeConfigSnapshot || problem?.judgeConfig || '{}') as any
      const io = resolveSubmissionIoSnapshot(claimed, config)
      return {
        taskType: 'submission' as const,
        submissionId: String(claimed.submissionId),
        problemId: claimed.problemInternalId,
        code: claimed.code,
        language: claimed.language,
        judgeRunId: claimed.judgeRunId,
        judgeAttemptId: claimed.judgeAttemptId,
        fencingToken: claimed.fencingToken,
        testdataPath: revision
          ? path.join(testdataRoot, claimed.problemInternalId, revision.testdataPath)
          : path.join(testdataRoot, claimed.problemInternalId),
        config,
        ioAdapterVersion: io.ioAdapterVersion,
        io: { inputFile: io.inputFile, outputFile: io.outputFile },
      }
    } catch (e: any) {
      if (claimed) {
        await retryOwnedJudgeAttempt({
          submissionId: claimed.submissionId,
          judgeAttemptId: claimed.judgeAttemptId,
          judgeId: this.judgeId,
          reason: `Task construction failed: ${e.message}`,
        }).catch(() => undefined)
      }
      logger.error('fetch_task_error', {
        action: 'judge_consumer',
        metadata: { judgeId: this.judgeId, error: e.message }
      })
      return null
    }
  }

  async fetchNextHackTask(): Promise<HackTask | null> {
    try {
      return await prisma.$transaction(async tx => {
        const candidates = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT candidate.id
          FROM "ProblemHackAttempt" candidate
          WHERE candidate.status = 'queuing'
            AND NOT EXISTS (
              SELECT 1 FROM "ProblemHackAttempt" active
              WHERE active."problemId" = candidate."problemId"
                AND active.status IN ('judging', 'finalizing')
            )
          ORDER BY candidate."createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `
        const candidate = candidates[0]
        if (!candidate) return null
        const attempt = await tx.problemHackAttempt.findUnique({ where: { id: candidate.id } })
        if (!attempt) return null
        const [problem, hackConfig] = await Promise.all([
          tx.problem.findUnique({ where: { id: attempt.problemId }, select: { judgeConfig: true, testGraphRevision: true, latestTestSetRevisionId: true } }),
          tx.problemHackConfig.findUnique({ where: { problemId: attempt.problemId } }),
        ])
        const baseRevision = attempt.baseTestSetRevisionId
          ? await tx.problemTestSetRevision.findFirst({ where: { id: attempt.baseTestSetRevisionId, problemId: attempt.problemId } })
          : null
        if (!problem || !hackConfig?.enabled || !baseRevision || hackConfig.revision !== attempt.hackConfigRevision ||
            baseRevision.judgeConfigHash !== attempt.judgeConfigHash ||
            (hackConfig.mode === 'oi' && problem.testGraphRevision !== attempt.testGraphRevision)) {
          await transitionHackAttempt(tx, {
            id: attempt.id,
            from: 'queuing',
            to: 'stale',
            data: { failureStage: 'stale', message: 'Hack 配置已变化，请重新发起', finishedAt: new Date() },
          })
          return null
        }
        const claimed = await transitionHackAttempt(tx, {
          id: attempt.id,
          from: 'queuing',
          to: 'judging',
          data: { judgeId: this.judgeId, judgeStarted: new Date() },
        })
        if (claimed.count !== 1) return null
        const testdataRoot = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')
        return {
          taskType: 'hack' as const,
          hackAttemptId: attempt.id,
          problemId: attempt.problemId,
          testdataPath: path.join(testdataRoot, attempt.problemId, baseRevision.testdataPath),
          config: yaml.load(baseRevision.judgeConfig || '{}'),
          judgeConfigHash: attempt.judgeConfigHash,
          hackConfigRevision: attempt.hackConfigRevision,
          hackMode: hackConfig.mode as 'acm' | 'oi',
          testGraphRevision: attempt.testGraphRevision,
          inputMode: attempt.inputMode as 'data' | 'generator',
          inputData: attempt.inputData || undefined,
          generatorSource: attempt.generatorSource || undefined,
          generatorLanguage: attempt.generatorLanguage || undefined,
          generatorProtocol: (attempt.generatorProtocol || 'legacy-empty-stdin-v1') as 'oj.generator/v1' | 'legacy-empty-stdin-v1',
          hackSource: attempt.hackSource,
          hackLanguage: attempt.hackLanguage,
          inputFilename: attempt.inputFilename,
          outputFilename: attempt.outputFilename,
          standardSource: hackConfig.standardSource,
          standardLanguage: hackConfig.standardLanguage as 'cpp17',
          validatorSource: hackConfig.validatorSource,
          validatorLanguage: hackConfig.validatorLanguage as 'cpp17' | 'python3',
          classifierSource: hackConfig.classifierSource || undefined,
          classifierLanguage: hackConfig.classifierLanguage as 'cpp17' | 'python3',
        }
      })
    } catch (error: any) {
      logger.error('fetch_hack_task_error', { action: 'judge_consumer', metadata: { judgeId: this.judgeId, error: error.message } })
      return null
    }
  }

  handleResult(taskType: 'submission' | 'hack' | 'data_generation' | 'candidate_evaluation' | 'judge_program_verification' | 'quality_evaluation_verification', id: string) {
    this.processing.delete(`${taskType}:${id}`)
    this.notify?.()
  }

  setConcurrency(n: number) {
    this.concurrency = n
    this.notify?.()
    logger.info('consumer_concurrency_updated', {
      action: 'judge_consumer',
      metadata: { judgeId: this.judgeId, concurrency: n }
    })
  }

  async destroy() {
    this.consuming = false
    this.notify?.()

    // 精准恢复该评测机的任务（断连时）
    const recoveredCount = this.processing.size
    for (const [, task] of this.processing) {
      try {
        if (task.taskType === 'submission') {
          await retryOwnedJudgeAttempt({
            submissionId: parseInt(task.id),
            judgeAttemptId: task.judgeAttemptId,
            judgeId: this.judgeId,
            reason: 'Judge connection closed before result persistence',
          })
        } else {
          if (task.taskType === 'data_generation') await prisma.problemDataGenerationJob.updateMany({
            where: { id: task.id, judgeId: this.judgeId, status: { in: ['running', 'finalizing'] } },
            data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null },
          })
          else if (task.taskType === 'candidate_evaluation') await recoverCandidateEvaluationRuns(this.judgeId)
          else if (task.taskType === 'judge_program_verification') await recoverJudgeProgramVerificationJobs(this.judgeId)
          else if (task.taskType === 'quality_evaluation_verification') await recoverQualityVerificationJobs(this.judgeId)
          else await transitionHackAttempts(prisma, {
            from: ['judging', 'finalizing'],
            to: 'queuing',
            where: { id: task.id, judgeId: this.judgeId },
            data: { judgeId: null, judgeStarted: null },
          })
        }
      } catch (e: any) {
        logger.error('reset_task_error', {
          action: 'judge_consumer',
          metadata: { taskType: task.taskType, taskId: task.id, error: e.message }
        })
      }
    }

    logger.info('consumer_destroyed', {
      action: 'judge_consumer',
      metadata: { judgeId: this.judgeId, recoveredCount }
    })
  }
}

interface JudgeTask {
  taskType: 'submission'
  submissionId: string
  problemId: string
  code: string
  language: string
  judgeRunId: string
  judgeAttemptId: string
  fencingToken: string
  dispatchedAt?: number
  testdataPath: string
  config: any
  ioAdapterVersion: number
  io: { inputFile: string | null; outputFile: string | null }
}

interface HackTask {
  taskType: 'hack'
  hackAttemptId: string
  problemId: string
  testdataPath: string
  config: any
  judgeConfigHash: string
  hackConfigRevision: number
  hackMode: 'acm' | 'oi'
  testGraphRevision: number
  inputMode: 'data' | 'generator'
  inputData?: string
  generatorSource?: string
  generatorLanguage?: string
  hackSource: string
  hackLanguage: string
  inputFilename?: string | null
  outputFilename?: string | null
  standardSource: string
  validatorSource: string
  classifierSource?: string
}

type DataGenerationTask = NonNullable<Awaited<ReturnType<typeof claimDataGenerationJob>>>
type CandidateEvaluationTask = NonNullable<Awaited<ReturnType<typeof claimCandidateEvaluationRun>>>
type JudgeProgramVerificationTask = NonNullable<Awaited<ReturnType<typeof claimJudgeProgramVerificationJob>>>
type QualityEvaluationVerificationTask = NonNullable<Awaited<ReturnType<typeof claimQualityVerificationJob>>>
type DispatchTask = JudgeTask | HackTask | DataGenerationTask | CandidateEvaluationTask | JudgeProgramVerificationTask | QualityEvaluationVerificationTask

/**
 * 初始化 WebSocket 服务器
 */
export function initJudgeWebSocket(server: import('node:http').Server) {
  acceptingJudgeTasks = true
  const judgeToken = process.env.JUDGE_TOKEN?.trim()
  const allowUnauthenticatedLocalJudge =
    process.env.ALLOW_UNAUTHENTICATED_JUDGE === 'true'

  if (!judgeToken && !allowUnauthenticatedLocalJudge) {
    logger.error('judge_ws_no_token', {
      message: 'JUDGE_TOKEN must be set unless loopback-only development is explicitly enabled'
    })
    throw new Error('JUDGE_TOKEN is required')
  }

  wss = new WebSocketServer({ server, path: '/ws/judge' })

  // 服务启动时恢复悬空任务
  if (process.env.SKIP_JUDGE_RECOVERY !== 'true') recoverAllStaleTasks()

  // 心跳检测定时器（每 30 秒）
  setInterval(() => {
    const now = Date.now()
    for (const [ws, lastPing] of judgeHeartbeats) {
      if (now - lastPing > 60 * 1000) { // 60 秒无心跳
        const judgeId = judges.get(ws)?.judgeId
        logger.warn('judge_heartbeat_timeout', { action: 'judge_ws', metadata: { judgeId } })
        ws.close() // 触发断连恢复
      }
    }
  }, 30 * 1000)

  // 超时任务扫描定时器（每 1 分钟）
  setInterval(async () => {
    try {
      const staleSubmissionCount = await recoverStaleJudgeAttempts({
        leaseBefore: new Date(),
        reason: 'Judge attempt lease expired',
      })
      const staleHacks = await transitionHackAttempts(prisma, {
        from: ['judging', 'finalizing'],
        to: 'queuing',
        where: { judgeStarted: { lt: new Date(Date.now() - 15 * 60 * 1000) } },
        data: { judgeId: null, judgeStarted: null },
      })
      const staleGeneration = await prisma.problemDataGenerationJob.updateMany({
        where: { status: { in: ['running', 'finalizing'] }, leaseExpiresAt: { lt: new Date() } },
        data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null },
      })
      const staleVerification = await prisma.problemJudgeProgramVerificationJob.updateMany({
        where: { status: 'running', leaseExpiresAt: { lt: new Date() } },
        data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null },
      })
      const staleCandidateEvaluation = await prisma.candidateEvaluationRun.updateMany({
        where: { status: 'running', leaseExpiresAt: { lt: new Date() } },
        data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null },
      })
      const staleQualityVerification = await prisma.qualityEvaluationJob.updateMany({
        where: { status: 'QUEUED', verificationStatus: 'running', verificationLeaseExpiresAt: { lt: new Date() } },
        data: { verificationStatus: 'pending', verificationJudgeId: null, verificationFencingToken: null, verificationLeaseExpiresAt: null },
      })

      if (staleSubmissionCount > 0 || staleHacks.count > 0 || staleGeneration.count > 0 || staleVerification.count > 0 || staleCandidateEvaluation.count > 0 || staleQualityVerification.count > 0) {
        logger.warn('stale_tasks_recovered', {
          action: 'judge_ws',
          metadata: { submissionCount: staleSubmissionCount, hackCount: staleHacks.count, dataGenerationCount: staleGeneration.count, programVerificationCount: staleVerification.count, candidateEvaluationCount: staleCandidateEvaluation.count, qualityVerificationCount: staleQualityVerification.count }
        })
      }
    } catch (e: any) {
      logger.error('stale_scan_error', {
        action: 'judge_ws',
        metadata: { error: e.message }
      })
    }
  }, 60 * 1000)

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress
    const isLoopback =
      clientIp === '127.0.0.1' ||
      clientIp === '::1' ||
      clientIp === '::ffff:127.0.0.1'
    const requiresAuth =
      Boolean(judgeToken) || !allowUnauthenticatedLocalJudge || !isLoopback

    // 从 URL query 或 first message 中获取 token
    let authenticated = !requiresAuth

    logger.info('judge_ws_connected', {
      action: 'judge_ws',
      metadata: { clientIp, requiresAuth }
    })

    if (requiresAuth && !judgeToken) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Judge authentication is not configured' }
      }))
      ws.close()
      return
    }

    // 认证超时：10 秒内必须完成认证
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        logger.warn('judge_ws_auth_timeout', { action: 'judge_ws' })
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Authentication timeout' } }))
        ws.close()
      }
    }, 10000)

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString())

        // 认证消息
        if (msg.type === 'auth') {
          if (judgeToken && msg.payload?.token !== judgeToken) {
            logger.warn('judge_ws_auth_failed', { action: 'judge_ws' })
            clearTimeout(authTimeout)
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid token' } }))
            ws.close()
            return
          }
          authenticated = true
          clearTimeout(authTimeout)
          ws.send(JSON.stringify({ type: 'auth_success' }))
          return
        }

        // 未认证时拒绝其他消息
        if (!authenticated) {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Not authenticated' } }))
          return
        }

        await handleMessage(ws, msg)
      } catch (e: any) {
        logger.error('judge_ws_parse_error', {
          action: 'judge_ws',
          metadata: { error: e.message }
        })
      }
    })

    ws.on('close', async () => {
      clearTimeout(authTimeout)
      const judge = judges.get(ws)
      if (judge) {
        // 断连时精准恢复该评测机的任务
        await judge.consumer?.destroy()

        logger.info('judge_ws_disconnected', {
          action: 'judge_ws',
          metadata: { judgeId: judge.judgeId }
        })
        judges.delete(ws)
      }
      judgeHeartbeats.delete(ws)
    })

    ws.on('error', (error) => {
      logger.error('judge_ws_error', {
        action: 'judge_ws',
        metadata: { error: error.message }
      })
    })
  })

  logger.info('judge_ws_started', {
    action: 'judge_ws',
    metadata: { path: '/ws/judge' }
  })
}

/**
 * Stop taking new work, allow in-flight Judge/Hack tasks to finish, then make
 * clients reconnect (1012 = service restart). Used by blue/green API promote.
 */
export async function drainJudgeWebSocket(timeoutMs = 30_000) {
  acceptingJudgeTasks = false
  for (const judge of judges.values()) judge.consumer?.notify?.()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const processing = [...judges.values()].reduce((total, judge) => total + (judge.consumer?.processing.size || 0), 0)
    if (processing === 0) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const remaining = [...judges.values()].reduce((total, judge) => total + (judge.consumer?.processing.size || 0), 0)
  for (const ws of judges.keys()) ws.close(1012, 'API deployment')
  if (wss) await new Promise<void>(resolve => wss!.close(() => resolve()))
  logger.info('judge_ws_drained', { action: 'judge_ws', metadata: { remaining } })
  return { remaining }
}

/**
 * 服务启动时恢复所有悬空任务
 */
async function recoverAllStaleTasks() {
  try {
    const recoveredCount = await recoverStaleJudgeAttempts({
      reason: 'API restart recovered an unfinished Judge attempt',
    })
    const recoveredHacks = await transitionHackAttempts(prisma, {
      from: ['judging', 'finalizing'],
      to: 'queuing',
      data: { judgeId: null, judgeStarted: null },
    })
    const recoveredGeneration = await prisma.problemDataGenerationJob.updateMany({ where: { status: { in: ['running', 'finalizing'] } }, data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null } })
    const recoveredVerification = await prisma.problemJudgeProgramVerificationJob.updateMany({ where: { status: 'running' }, data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null } })
    const recoveredCandidateEvaluation = await prisma.candidateEvaluationRun.updateMany({ where: { status: 'running' }, data: { status: 'queued', judgeId: null, fencingToken: null, leaseExpiresAt: null, startedAt: null } })
    const recoveredQualityVerification = await prisma.qualityEvaluationJob.updateMany({ where: { status: 'QUEUED', verificationStatus: 'running' }, data: { verificationStatus: 'pending', verificationJudgeId: null, verificationFencingToken: null, verificationLeaseExpiresAt: null } })

    if (recoveredCount > 0 || recoveredHacks.count > 0 || recoveredGeneration.count > 0 || recoveredVerification.count > 0 || recoveredCandidateEvaluation.count > 0 || recoveredQualityVerification.count > 0) {
      logger.info('startup_recovered_stale_tasks', {
        action: 'judge_ws',
        metadata: { submissionCount: recoveredCount, hackCount: recoveredHacks.count, dataGenerationCount: recoveredGeneration.count, programVerificationCount: recoveredVerification.count, candidateEvaluationCount: recoveredCandidateEvaluation.count, qualityVerificationCount: recoveredQualityVerification.count }
      })
    }
  } catch (e: any) {
    logger.error('startup_recovery_error', {
      action: 'judge_ws',
      metadata: { error: e.message }
    })
  }
}

/**
 * 处理消息
 */
async function handleMessage(ws: WebSocket, msg: any) {
  const heartbeat = getHeartbeatAction(msg.type)
  if (heartbeat.handled) {
    judgeHeartbeats.set(ws, Date.now())
    if (heartbeat.reply) {
      ws.send(JSON.stringify({ type: heartbeat.reply }))
    }
    return
  }

  switch (msg.type) {
    case 'register':
      await handleRegister(ws, msg.payload)
      break
    case 'start':
      await handleStart(ws, msg.payload)
      break
    case 'config':
      handleConfig(ws, msg.payload)
      break
    case 'result':
      await handleResult(ws, msg.payload)
      break
    case 'hack_result':
      await handleHackResult(ws, msg.payload)
      break
    case 'data_generation_result':
      await handleDataGenerationResult(ws, msg.payload)
      break
    case 'candidate_evaluation_result':
      await handleCandidateEvaluationResult(ws, msg.payload)
      break
    case 'judge_program_verification_result':
      await handleJudgeProgramVerificationResult(ws, msg.payload)
      break
    case 'quality_evaluation_verification_result':
      await handleQualityEvaluationVerificationResult(ws, msg.payload)
      break
    default:
      logger.warn('judge_ws_unknown_message', {
        action: 'judge_ws',
        metadata: { type: msg.type }
      })
  }
}

async function handleDataGenerationResult(ws: WebSocket, payload: any) {
  const connection = judges.get(ws)
  if (!connection) return
  try { await finalizeDataGenerationJob(connection.judgeId, payload) }
  finally { connection.consumer?.handleResult('data_generation', String(payload?.jobId || '')) }
}

async function handleCandidateEvaluationResult(ws: WebSocket, payload: any) {
  const connection = judges.get(ws)
  if (!connection) return
  try { await finalizeCandidateEvaluationRun(connection.judgeId, payload) }
  catch (error: any) {
    logger.error('candidate_evaluation_finalize_error', { action: 'judge_consumer', metadata: { runId: payload?.runId, error: error.message } })
    ws.close(1011, 'candidate evaluation persistence unavailable')
    return
  }
  connection.consumer?.handleResult('candidate_evaluation', String(payload?.runId || ''))
}

async function handleJudgeProgramVerificationResult(ws: WebSocket, payload: any) {
  const connection = judges.get(ws)
  if (!connection) return
  try { await finalizeJudgeProgramVerificationJob(connection.judgeId, payload) }
  finally { connection.consumer?.handleResult('judge_program_verification', String(payload?.jobId || '')) }
}

async function handleQualityEvaluationVerificationResult(ws: WebSocket, payload: any) {
  const connection = judges.get(ws)
  if (!connection) return
  try { await finalizeQualityVerificationJob(connection.judgeId, payload) }
  finally { connection.consumer?.handleResult('quality_evaluation_verification', String(payload?.jobId || '')) }
}

/**
 * 处理评测机注册
 */
async function handleRegister(ws: WebSocket, payload: { judgeId: string; languages: string[] }) {
  const { judgeId, languages } = payload

  judges.set(ws, {
    ws,
    judgeId,
    languages,
    consumer: null
  })

  judgeHeartbeats.set(ws, Date.now())

  logger.info('judge_ws_registered', {
    action: 'judge_ws',
    metadata: { judgeId, languages }
  })

  // 发送确认
  ws.send(JSON.stringify({
    type: 'registered',
    payload: { judgeId }
  }))
}

/**
 * 处理评测机启动消费
 */
async function handleStart(ws: WebSocket, payload: { concurrency?: number; judgeId?: string }) {
  const judge = judges.get(ws)
  if (!judge) {
    ws.send(JSON.stringify({ type: 'error', payload: { message: 'Not registered' } }))
    return
  }

  const judgeId = payload.judgeId || judge.judgeId || generateId()
  const concurrency = payload.concurrency || 1

  // 更新 judgeId（如果提供了新的）
  if (payload.judgeId) {
    judge.judgeId = payload.judgeId
  }

  // 创建 Consumer
  const consumer = new JudgeConsumer(ws, judgeId, concurrency)
  judge.consumer = consumer

  consumer.consuming = true
  consumer.consume()

  ws.send(JSON.stringify({
    type: 'started',
    payload: { judgeId, concurrency }
  }))

  logger.info('judge_consumer_started', {
    action: 'judge_ws',
    metadata: { judgeId, concurrency }
  })
}

/**
 * 处理动态调整并发
 */
function handleConfig(ws: WebSocket, payload: { concurrency?: number }) {
  const judge = judges.get(ws)
  if (!judge?.consumer) {
    logger.warn('config_no_consumer', {
      action: 'judge_ws',
      metadata: { judgeId: judge?.judgeId }
    })
    return
  }

  if (payload.concurrency && Number.isSafeInteger(payload.concurrency) && payload.concurrency > 0) {
    judge.consumer.setConcurrency(payload.concurrency)
  }
}

/**
 * 处理评测结果
 */
async function handleResult(ws: WebSocket, payload: any) {
  const { submissionId, result, time, wallTime, memory, score, timeoutReason, metricSource } = payload

  const connection = judges.get(ws)
  const resultReceivedAt = new Date()

  logger.info('judge_ws_result', {
    action: 'judge_ws',
    metadata: { submissionId, result, time, wallTime, memory, score, timeoutReason, metricSource }
  })

  // 更新数据库
  try {
    if (!connection?.judgeId) return
    const claimed = await retryJudgePersistence(
      () => persistOwnedSubmissionResult(payload, connection.judgeId, resultReceivedAt),
      { taskType: 'submission', taskId: String(submissionId) },
    )
    connection.consumer?.handleResult('submission', String(submissionId))
    if (!claimed) {
      logger.warn('judge_ws_stale_result_ignored', {
        action: 'judge_ws', metadata: { submissionId, judgeId: connection.judgeId },
      })
      return
    }

    logger.info('judge_ws_db_updated', { action: 'judge_ws', metadata: { submissionId } })

  } catch (e: any) {
    logger.error('judge_ws_update_error', {
      action: 'judge_ws',
      metadata: { submissionId, error: e.message }
    })
    // Keep the task in the Consumer ownership map. Closing the socket invokes
    // conditional destroy() recovery; it can no longer overwrite a terminal
    // result that won the CAS while the connection was closing.
    ws.close(1011, 'database persistence unavailable')
  }
}

export async function retryJudgePersistence<T>(
  operation: () => Promise<T>,
  context: { taskType: 'submission' | 'hack'; taskId: string },
): Promise<T> {
  const timeoutMs = Math.max(1_000, Number(process.env.JUDGE_RESULT_DB_RETRY_MS || 60_000))
  const deadline = Date.now() + timeoutMs
  let attempt = 0
  while (true) {
    try {
      return await operation()
    } catch (error: any) {
      attempt++
      if (Date.now() >= deadline) throw error
      const delayMs = Math.min(2_000, 100 * (2 ** Math.min(attempt - 1, 5)))
      logger.warn('judge_result_persistence_retry', {
        action: 'judge_ws',
        metadata: { ...context, attempt, delayMs, error: error.message },
      })
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}

export async function persistOwnedSubmissionResult(payload: any, judgeId: string, resultReceivedAt = new Date()): Promise<boolean> {
  const submissionId = Number.parseInt(String(payload?.submissionId || ''), 10)
  const judgeRunId = String(payload?.judgeRunId || '')
  const judgeAttemptId = String(payload?.judgeAttemptId || '')
  const fencingToken = String(payload?.fencingToken || '')
  if (!Number.isSafeInteger(submissionId) || !judgeId || !judgeRunId || !judgeAttemptId || !fencingToken) return false
  const result = normalizeResult(payload.result)
  const submission = await finalizeOwnedJudgeAttempt({
    submissionId,
    judgeRunId,
    judgeAttemptId,
    fencingToken,
    judgeId,
    performance: {
      resultReceivedAt,
      dispatchLatencyMs: payload.phaseMetrics?.dispatchMs,
      compileLatencyMs: payload.phaseMetrics?.compileMs,
      runLatencyMs: payload.phaseMetrics?.runMs,
    },
    projection: {
      result,
      timeUsed: payload.time,
      wallTimeUsed: payload.wallTime ?? null,
      memoryUsed: payload.memory ?? null,
      timeoutReason: payload.timeoutReason ?? null,
      metricSource: payload.metricSource ?? null,
      score: payload.score ?? null,
      cases: payload.cases ? JSON.stringify(payload.cases) : null,
      subtasks: payload.subtasks ? JSON.stringify(payload.subtasks) : null,
      errorMessage: payload.message,
    },
  })
  if (!submission) return false
  try {
    await onSubmissionJudged(submission)
  } catch (syncErr: any) {
    logger.error('judge_ws_sync_error', {
      action: 'judge_ws', metadata: { submissionId, error: syncErr.message },
    })
  }
  return true
}

async function handleHackResult(ws: WebSocket, payload: any) {
  const hackAttemptId = String(payload?.hackAttemptId || '')
  if (!hackAttemptId) return
  const connection = judges.get(ws)
  logger.info('judge_ws_hack_result', {
    action: 'judge_ws',
    metadata: {
      hackAttemptId,
      outcome: payload.outcome,
      baselineResult: payload.baselineResult,
      candidateResult: payload.candidateResult,
    },
  })
  try {
    await retryJudgePersistence(
      () => finalizeHackResult(payload, { judgeId: connection?.judgeId }),
      { taskType: 'hack', taskId: hackAttemptId },
    )
    connection?.consumer?.handleResult('hack', hackAttemptId)
  } catch (error: any) {
    logger.error('judge_ws_hack_finalize_error', {
      action: 'judge_ws',
      metadata: { hackAttemptId, error: error.message },
    })
    ws.close(1011, 'database persistence unavailable')
  }
}

/**
 * 重新评测提交（rejudge）
 * 将提交状态重置为 queuing，Consumer 会自动消费
 */
export async function rejudgeSubmission(submissionId: number, requestedBy = 'system'): Promise<{ success: boolean; message: string }> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId }
  })

  if (!submission) {
    return { success: false, message: '提交不存在' }
  }

  if (submission.submitMethod === 'archive') {
    return { success: false, message: '远程归档记录不支持重新评测' }
  }

  if (!submission.problemInternalId) {
    return { success: false, message: '提交缺少题目内部 ID' }
  }

  const queued = await rejudgeSubmissionWithRun(submissionId, requestedBy)
  if (!queued) return { success: false, message: '提交正在排队或评测中，未重复加入队列' }

  logger.info('rejudge_queued', {
    action: 'rejudge',
    metadata: { submissionId }
  })

  return { success: true, message: '已加入评测队列' }
}

/**
 * 获取评测机状态
 */
export function getJudgeStatus() {
  return {
    totalJudges: judges.size,
    activeConsumers: Array.from(judges.values()).filter(j => j.consumer?.consuming).length,
    judges: Array.from(judges.values()).map(j => ({
      judgeId: j.judgeId,
      languages: j.languages,
      consuming: j.consumer?.consuming || false,
      concurrency: j.consumer?.concurrency || 0,
      processingCount: j.consumer?.processing.size || 0
    }))
  }
}

// 导出 dispatchJudgeTask 为空函数（兼容旧代码）
export async function dispatchJudgeTask(params: any): Promise<any> {
  // 新模式：不再直接分发，任务入队后由 Consumer 自动消费
  throw new Error('dispatchJudgeTask 已废弃，请使用 Submission 入队模式')
}
