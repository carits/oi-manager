/**
 * WebSocket 评测机服务端
 *
 * 处理评测机连接，分发评测任务，接收评测结果
 */

import { Router, Request, Response } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { httpServer } from '../index'
import { prisma } from '../prisma'
import { logger } from '../lib/logger'
import path from 'path'

// 评测机连接
interface JudgeConnection {
  ws: WebSocket
  judgeId: string
  languages: string[]
  isAvailable: boolean
}

// 连接的评测机
const judges = new Map<WebSocket, JudgeConnection>()

// 等待中的评测任务
interface PendingTask {
  submissionId: string
  resolve: (result: any) => void
  reject: (error: Error) => void
}

const pendingTasks = new Map<string, PendingTask>()

let wss: WebSocketServer | null = null

/**
 * 初始化 WebSocket 服务器
 */
export function initJudgeWebSocket() {
  // 使用已有的 HTTP 服务器
  const server = (global as any).httpServer
  if (!server) {
    logger.error('judge_ws_no_server', { message: 'HTTP server not found' })
    return
  }

  wss = new WebSocketServer({ server, path: '/ws/judge' })

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress
    logger.info('judge_ws_connected', {
      action: 'judge_ws',
      metadata: { clientIp }
    })

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString())
        await handleMessage(ws, msg)
      } catch (e: any) {
        logger.error('judge_ws_parse_error', {
          action: 'judge_ws',
          metadata: { error: e.message }
        })
      }
    })

    ws.on('close', () => {
      const judge = judges.get(ws)
      if (judge) {
        logger.info('judge_ws_disconnected', {
          action: 'judge_ws',
          metadata: { judgeId: judge.judgeId }
        })
        judges.delete(ws)
      }
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
 * 处理消息
 */
async function handleMessage(ws: WebSocket, msg: any) {
  switch (msg.type) {
    case 'register':
      await handleRegister(ws, msg.payload)
      break
    case 'result':
      await handleResult(msg.payload)
      break
    case 'pong':
      // ignore
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
    isAvailable: true
  })

  logger.info('judge_ws_registered', {
    action: 'judge_ws',
    metadata: { judgeId, languages }
  })

  // 发送确认
  ws.send(JSON.stringify({
    type: 'registered',
    payload: { judgeId }
  }))

  // 自动恢复卡在 queuing 的任务
  recoverQueuingSubmissions()
}

/**
 * 恢复卡在 queuing 状态的提交
 * 评测机注册时调用，重新分发所有未完成的 Carits 提交
 */
async function recoverQueuingSubmissions() {
  const stuck = await prisma.submission.findMany({
    where: { result: 'queuing', oj: 'carits' },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  if (stuck.length === 0) return

  logger.info('recover_queuing_start', {
    action: 'judge_ws',
    metadata: { count: stuck.length },
  })

  for (const s of stuck) {
    try {
      await rejudgeSubmission(s.id)
    } catch (e: any) {
      logger.error('recover_queuing_error', {
        action: 'judge_ws',
        metadata: { submissionId: s.id, error: e.message },
      })
    }
  }
}

/**
 * 处理评测结果
 */
async function handleResult(payload: any) {
  const { submissionId, result, time, memory, score, cases, subtasks, message } = payload

  logger.info('judge_ws_result', {
    action: 'judge_ws',
    metadata: { submissionId, result, time, memory, score, casesCount: cases?.length, subtasksCount: subtasks?.length }
  })

  console.log(`[JudgeWS] Result received: submission=${submissionId}, result=${result}, score=${score}, cases=${cases?.length || 0}, subtasks=${subtasks?.length || 0}`)

  // 更新数据库
  try {
    const updateData = {
      result: mapResult(result),
      timeUsed: time,
      memoryUsed: memory,
      score: score ?? null,
      cases: cases ? JSON.stringify(cases) : null,
      subtasks: subtasks ? JSON.stringify(subtasks) : null,
    }
    console.log(`[JudgeWS] Updating DB: score=${updateData.score}, cases_len=${updateData.cases?.length || 0}, subtasks=${!!updateData.subtasks}`)

    // 统一更新 Submission 表（训练和题库提交共用）
    await prisma.submission.update({
      where: { id: parseInt(submissionId) },
      data: { ...updateData, errorMessage: message },
    })
    console.log(`[JudgeWS] DB updated successfully for submission=${submissionId}`)
  } catch (e: any) {
    logger.error('judge_ws_update_error', {
      action: 'judge_ws',
      metadata: { submissionId, error: e.message }
    })
    console.error(`[JudgeWS] DB update error: ${e.message}`)
  }

  // 解析等待中的任务
  const pending = pendingTasks.get(submissionId)
  if (pending) {
    pending.resolve(payload)
    pendingTasks.delete(submissionId)
  }
}

/**
 * 分发评测任务
 */
export async function dispatchJudgeTask(params: {
  submissionId: string
  problemId: string
  code: string
  language: string
  testdataPath: string
  problemConfig: any
}): Promise<any> {
  const { submissionId, problemId, code, language, testdataPath, problemConfig } = params

  // 查找可用的评测机
  const availableJudges = Array.from(judges.values()).filter(j => j.isAvailable)

  if (availableJudges.length === 0) {
    throw new Error('没有可用的评测机')
  }

  // 选择第一个可用评测机
  const judge = availableJudges[0]

  logger.info('judge_ws_dispatch', {
    action: 'judge_ws',
    metadata: { submissionId, judgeId: judge.judgeId, language }
  })

  // 创建等待 Promise
  const taskPromise = new Promise<any>((resolve, reject) => {
    pendingTasks.set(submissionId, { submissionId, resolve, reject })

    // 超时处理
    setTimeout(() => {
      if (pendingTasks.has(submissionId)) {
        pendingTasks.delete(submissionId)
        reject(new Error('评测超时'))
      }
    }, 60000) // 60 秒超时
  })

  // 发送任务
  judge.ws.send(JSON.stringify({
    type: 'judge',
    payload: {
      submissionId,
      problemId,
      code,
      language,
      config: problemConfig,
      testdataPath
    }
  }))

  return taskPromise
}

/**
 * 映射评测结果
 */
function mapResult(result: string): string {
  const resultMap: Record<string, string> = {
    'Accepted': 'accepted',
    'Wrong Answer': 'wa',
    'Time Limit Exceeded': 'tle',
    'Memory Limit Exceeded': 'mle',
    'Runtime Error': 're',
    'Compilation Error': 'ce',
    'Presentation Error': 'pe',
    'Output Limit Exceeded': 'ole',
    'System Error': 'se',
    'Waiting': 'queuing',
    'Judging': 'judging'
  }

  return resultMap[result] || result.toLowerCase()
}

/**
 * 重新评测提交（rejudge）
 * 将提交状态重置为 queuing，然后重新分发到评测机
 */
export async function rejudgeSubmission(submissionId: number): Promise<{ success: boolean; message: string }> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
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

  // 重置状态
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
      ojRemoteId: submissionId.toString(), // Carits 平台：远程提交ID就是本地评测ID
    },
  })

  // 获取评测配置
  const problem = await prisma.problem.findUnique({
    where: { id: submission.problemInternalId },
    select: { judgeConfig: true },
  })

  let problemConfig: any = {}
  if (problem?.judgeConfig) {
    try {
      const yaml = await import('js-yaml')
      problemConfig = yaml.load(problem.judgeConfig) || {}
    } catch (e) {
      logger.warn('rejudge_parse_config_error', { error: e })
    }
  }

  const testdataPath = path.join(process.cwd(), 'testdata', submission.problemInternalId)

  // 分发评测任务
  try {
    await dispatchJudgeTask({
      submissionId: submissionId.toString(),
      problemId: submission.problemInternalId,
      code: submission.code,
      language: submission.language,
      testdataPath,
      problemConfig,
    })

    logger.info('rejudge_dispatched', {
      action: 'rejudge',
      metadata: { submissionId },
    })

    return { success: true, message: '已重新提交评测' }
  } catch (e: any) {
    // 评测机不可用，状态保持 queuing，下次可再 rejudge
    logger.error('rejudge_dispatch_error', {
      action: 'rejudge',
      metadata: { submissionId, error: e.message },
    })
    return { success: false, message: e.message || '评测服务不可用' }
  }
}

/**
 * 获取评测机状态
 */
export function getJudgeStatus() {
  return {
    totalJudges: judges.size,
    availableJudges: Array.from(judges.values()).filter(j => j.isAvailable).length,
    judges: Array.from(judges.values()).map(j => ({
      judgeId: j.judgeId,
      languages: j.languages,
      isAvailable: j.isAvailable
    }))
  }
}