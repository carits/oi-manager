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

    // Check if this is a TrainingSubmission (prefixed with 'T-') or regular Submission
    if (submissionId.startsWith('T-')) {
      const realId = parseInt(submissionId.slice(2))
      await prisma.trainingSubmission.update({
        where: { id: realId },
        data: updateData,
      })
    } else {
      await prisma.submission.update({
        where: { id: parseInt(submissionId) },
        data: { ...updateData, errorMessage: message },
      })
    }
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