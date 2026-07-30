/**
 * WebSocket 评测机服务端
 *
 * 处理评测机连接，采用 Hydro 风格的持久化队列模式：
 * - 评测机主动消费 Submission 表（queuing → judging）
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
import { getHeartbeatAction } from './judge-protocol'

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

/**
 * JudgeConsumer 类：轮询 Submission 表，分发任务到评测机
 */
class JudgeConsumer {
  consuming: boolean = false
  processing: Map<string, { submissionId: string; startTime: number }> = new Map()
  concurrency: number = 1
  notify: ((value?: unknown) => void) | null = null
  ws: WebSocket
  judgeId: string

  constructor(ws: WebSocket, judgeId: string, concurrency: number = 1) {
    this.ws = ws
    this.judgeId = judgeId
    this.concurrency = concurrency
  }

  async consume() {
    while (this.consuming) {
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

      this.processing.set(task.submissionId, { submissionId: task.submissionId, startTime: Date.now() })

      logger.info('consumer_task_dispatched', {
        action: 'judge_consumer',
        metadata: { judgeId: this.judgeId, submissionId: task.submissionId, processingSize: this.processing.size }
      })

      // 发送任务到评测机
      this.ws.send(JSON.stringify({
        type: 'judge',
        payload: task
      }))
    }
  }

  async fetchNextTask(): Promise<JudgeTask | null> {
    try {
      return await prisma.$transaction(async (tx) => {
        const candidates = await tx.$queryRaw<Array<{ id: number }>>`
          SELECT id
          FROM "Submission"
          WHERE result = 'queuing' AND oj = 'carits'
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `
        const candidate = candidates[0]
        if (!candidate) return null

        const submission = await tx.submission.findUnique({
          where: { id: candidate.id },
          select: { id: true, problemInternalId: true, code: true, language: true }
        })
        if (!submission) return null

        // 标记为 judging，同时记录评测机 ID 和开始时间
        await tx.submission.update({
          where: { id: submission.id },
          data: {
            result: 'judging',
            judgeId: this.judgeId,
            judgeStarted: new Date()
          }
        })

        // 构建任务数据
        const problem = await tx.problem.findUnique({
          where: { id: submission.problemInternalId! },
          select: { judgeConfig: true }
        })

        // 统一使用 TESTDATA_DIR 环境变量
        const TESTDATA_DIR = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')

        return {
          submissionId: submission.id.toString(),
          problemId: submission.problemInternalId!,
          code: submission.code,
          language: submission.language,
          testdataPath: path.join(TESTDATA_DIR, submission.problemInternalId!),
          config: problem?.judgeConfig ? yaml.load(problem.judgeConfig) : {}
        }
      })
    } catch (e: any) {
      logger.error('fetch_task_error', {
        action: 'judge_consumer',
        metadata: { judgeId: this.judgeId, error: e.message }
      })
      return null
    }
  }

  handleResult(submissionId: string) {
    this.processing.delete(submissionId)
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
    for (const [id, _] of this.processing) {
      try {
        await prisma.submission.update({
          where: { id: parseInt(id) },
          data: {
            result: 'queuing',
            judgeId: null,
            judgeStarted: null
          }
        })
      } catch (e: any) {
        logger.error('reset_task_error', {
          action: 'judge_consumer',
          metadata: { submissionId: id, error: e.message }
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
  submissionId: string
  problemId: string
  code: string
  language: string
  testdataPath: string
  config: any
}

/**
 * 初始化 WebSocket 服务器
 */
export function initJudgeWebSocket() {
  const judgeToken = process.env.JUDGE_TOKEN?.trim()
  const allowUnauthenticatedLocalJudge =
    process.env.ALLOW_UNAUTHENTICATED_JUDGE === 'true'

  if (!judgeToken && !allowUnauthenticatedLocalJudge) {
    logger.error('judge_ws_no_token', {
      message: 'JUDGE_TOKEN must be set unless loopback-only development is explicitly enabled'
    })
    throw new Error('JUDGE_TOKEN is required')
  }

  // 使用已有的 HTTP 服务器
  const server = (global as any).httpServer
  if (!server) {
    logger.error('judge_ws_no_server', { message: 'HTTP server not found' })
    return
  }

  wss = new WebSocketServer({ server, path: '/ws/judge' })

  // 服务启动时恢复悬空任务
  recoverAllStaleTasks()

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
      const stale = await prisma.submission.updateMany({
        where: {
          result: 'judging',
          judgeStarted: { lt: new Date(Date.now() - 5 * 60 * 1000) } // 5 分钟前
        },
        data: {
          result: 'queuing',
          judgeId: null,
          judgeStarted: null
        }
      })

      if (stale.count > 0) {
        logger.warn('stale_tasks_recovered', {
          action: 'judge_ws',
          metadata: { count: stale.count }
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
 * 服务启动时恢复所有悬空任务
 */
async function recoverAllStaleTasks() {
  try {
    // 恢复所有 judging 状态的任务（上次服务重启遗留）
    const recovered = await prisma.submission.updateMany({
      where: { result: 'judging', oj: 'carits' },
      data: {
        result: 'queuing',
        judgeId: null,
        judgeStarted: null
      }
    })

    if (recovered.count > 0) {
      logger.info('startup_recovered_stale_tasks', {
        action: 'judge_ws',
        metadata: { count: recovered.count }
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
    default:
      logger.warn('judge_ws_unknown_message', {
        action: 'judge_ws',
        metadata: { type: msg.type }
      })
  }
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
  const { submissionId, result, time, memory, score, cases, subtasks, message } = payload

  logger.info('judge_ws_result', {
    action: 'judge_ws',
    metadata: { submissionId, result, time, memory, score }
  })

  // 更新数据库
  try {
    const updateData = {
      result: normalizeResult(result),
      timeUsed: time,
      memoryUsed: memory,
      score: score ?? null,
      cases: cases ? JSON.stringify(cases) : null,
      subtasks: subtasks ? JSON.stringify(subtasks) : null,
      judgeId: null,
      judgeStarted: null
    }

    await prisma.submission.update({
      where: { id: parseInt(submissionId) },
      data: { ...updateData, errorMessage: message }
    })

    logger.info('judge_ws_db_updated', { action: 'judge_ws', metadata: { submissionId } })

    // 触发 AC 同步（submitScope/trainingId/contestId 等字段由创建时设置）
    try {
      const submission = await prisma.submission.findUnique({
        where: { id: parseInt(submissionId) },
        select: {
          id: true,
          userId: true,
          problemId: true,
          result: true,
          score: true,
          submitScope: true,
          trainingId: true,
          trainingProblemId: true,
          contestId: true,
          contestProblemId: true,
        },
      })
      if (submission) {
        await onSubmissionJudged(submission)
      }
    } catch (syncErr: any) {
      logger.error('judge_ws_sync_error', {
        action: 'judge_ws',
        metadata: { submissionId, error: syncErr.message }
      })
    }
  } catch (e: any) {
    logger.error('judge_ws_update_error', {
      action: 'judge_ws',
      metadata: { submissionId, error: e.message }
    })
  }

  // 通知 Consumer 任务完成
  const judge = judges.get(ws)
  judge?.consumer?.handleResult(submissionId)
}

/**
 * 重新评测提交（rejudge）
 * 将提交状态重置为 queuing，Consumer 会自动消费
 */
export async function rejudgeSubmission(submissionId: number): Promise<{ success: boolean; message: string }> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId }
  })

  if (!submission) {
    return { success: false, message: '提交不存在' }
  }

  if (submission.oj !== 'carits') {
    return { success: false, message: '仅支持 Carits 平台题目的 rejudge' }
  }

  if (!submission.problemInternalId) {
    return { success: false, message: '提交缺少题目内部 ID' }
  }

  // 重置状态为 queuing（入队）
  await prisma.submission.update({
    where: { id: submissionId },
    data: {
      result: 'queuing',
      timeUsed: null,
      memoryUsed: null,
      score: null,
      cases: null,
      subtasks: null,
      errorMessage: null,
      judgeId: null,
      judgeStarted: null,
      ojRemoteId: submissionId.toString()
    }
  })

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
