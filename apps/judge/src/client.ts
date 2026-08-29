/**
 * WebSocket 客户端
 *
 * Hydro-style 持久化队列模式：
 * - 服务端 Consumer 主动从 Submission 表消费任务
 * - 客户端发送 start 消息启动服务端消费
 * - 并发由服务端通过 WebSocket config 消息控制
 * - 心跳检测（每 30 秒发送 ping）
 */

import WebSocket from 'ws'
import { config } from './config'
import { judge } from './judge'
import { judgeHack } from './hack'
import type { HackMessage, HackResultMessage, JudgeMessage, ResultMessage, RegisterMessage, WSMessage } from './types'
import { getClientHeartbeatReply } from './protocol'
import { judgeTelemetry } from './telemetry'

class JudgeClient {
  private ws: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private isConnected = false
  private isAuthenticated = false
  private judgeId: string | null = null

  connect() {
    const url = `${config.backendUrl}/ws/judge`

    console.log(`[Judge] Connecting to ${url}...`)
    judgeTelemetry.increment('connection.attempted')

    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      console.log('[Judge] Connected to backend')
      this.isConnected = true
      judgeTelemetry.setConnection(true)

      // 如果有 token，先发送认证消息
      if (config.judgeToken) {
        const authMsg = {
          type: 'auth',
          payload: { token: config.judgeToken }
        }
        this.ws!.send(JSON.stringify(authMsg))
        console.log('[Judge] Sent authentication message')
      } else {
        // 开发环境无 token，直接注册
        this.register()
      }
    })

    this.ws.on('message', async (data: Buffer) => {
      try {
        const msg: WSMessage = JSON.parse(data.toString())
        await this.handleMessage(msg)
      } catch (e: any) {
        judgeTelemetry.increment('message.parse_failed')
        console.error('[Judge] Failed to parse message:', e.message)
      }
    })

    this.ws.on('close', () => {
      console.log('[Judge] Disconnected from backend')
      this.isConnected = false
      this.isAuthenticated = false
      this.judgeId = null
      this.stopHeartbeat()
      judgeTelemetry.setConnection(false)
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      judgeTelemetry.increment('connection.error')
      console.error('[Judge] WebSocket error:', err.message)
    })
  }

  private register() {
    // 注册评测机
    const registerMsg: RegisterMessage = {
      type: 'register',
      payload: {
        judgeId: config.judgeId,
        languages: ['c', 'c11', 'cpp', 'cpp11', 'cpp14', 'cpp17', 'cpp20', 'python3']
      }
    }
    this.send(registerMsg)
  }

  private async handleMessage(msg: WSMessage) {
    judgeTelemetry.noteMessage()
    const heartbeatReply = getClientHeartbeatReply(msg.type)
    if (heartbeatReply !== undefined) {
      if (heartbeatReply) {
        this.send({ type: heartbeatReply, payload: {} })
      }
      return
    }

    switch (msg.type) {
      case 'auth_success':
        console.log('[Judge] Authentication successful')
        this.isAuthenticated = true
        judgeTelemetry.setAuthenticated(true)
        this.register()
        break
      case 'error':
        console.error('[Judge] Server error:', msg.payload?.message)
        if (msg.payload?.message?.includes('token') || msg.payload?.message?.includes('auth')) {
          this.isAuthenticated = false
          judgeTelemetry.setAuthenticated(false)
          this.ws?.close()
        }
        break
      case 'registered':
        // 服务端确认注册成功
        this.judgeId = msg.payload?.judgeId || config.judgeId
        console.log('[Judge] Registration confirmed, judgeId:', this.judgeId)
        // 注册成功后发送 start 消息启动服务端 Consumer
        this.send({
          type: 'start',
          payload: {
            judgeId: this.judgeId,
            concurrency: config.maxConcurrent
          }
        })
        // 启动心跳
        this.startHeartbeat()
        break
      case 'started':
        console.log('[Judge] Consumer started, concurrency:', msg.payload?.concurrency)
        break
      case 'judge':
        await this.handleJudgeTask(msg as JudgeMessage)
        break
      case 'hack':
        await this.handleHackTask(msg as HackMessage)
        break
      default:
        judgeTelemetry.increment('message.unknown')
        console.log('[Judge] Unknown message type:', msg.type)
    }
  }

  private async handleHackTask(msg: HackMessage) {
    const { hackAttemptId, problemId } = msg.payload
    console.log(`[Judge] Received Hack task: attempt=${hackAttemptId}, problem=${problemId}`)
    const telemetryStartedAt = judgeTelemetry.startTask('hack')
    let payload
    try {
      payload = await judgeHack(msg.payload)
    } catch (error: any) {
      payload = { hackAttemptId, outcome: 'system_error' as const, message: error.message }
    }
    if (payload.retryable) {
      judgeTelemetry.finishTask('hack', 'infrastructure_retry', telemetryStartedAt)
      console.warn(`[Judge] Retryable Hack infrastructure failure: attempt=${hackAttemptId}; reconnecting for requeue`)
      this.ws?.close(1011, 'sandbox infrastructure unavailable')
      return
    }
    const result: HackResultMessage = { type: 'hack_result', payload }
    judgeTelemetry.finishTask('hack', payload.outcome || 'unknown', telemetryStartedAt)
    this.send(result)
  }

  private async handleJudgeTask(msg: JudgeMessage) {
    // 兼容旧字段名 problemConfig 和新字段名 config
    const {
      submissionId,
      judgeRunId,
      judgeAttemptId,
      fencingToken,
      dispatchedAt,
      problemId,
      code,
      language,
      testdataPath,
    } = msg.payload
    const config = msg.payload.config ?? msg.payload.problemConfig ?? {}

    console.log(`[Judge] Received task: submission=${submissionId}, problem=${problemId}, lang=${language}`)
    const telemetryStartedAt = judgeTelemetry.startTask('submission')
    const receivedAt = Date.now()
    const judgeStartedAt = performance.now()

    // 直接执行评测任务（无 PQueue，并发由服务端 Consumer 控制）
    try {
      const result = await judge({
        submissionId,
        judgeRunId,
        judgeAttemptId,
        fencingToken,
        dispatchedAt,
        problemId,
        code,
        language,
        config: config,
        testdataPath
      })

      if (result.retryable) {
        judgeTelemetry.finishTask('submission', 'infrastructure_retry', telemetryStartedAt)
        console.warn(`[Judge] Retryable infrastructure failure: submission=${submissionId}; reconnecting for requeue`)
        this.ws?.close(1011, 'sandbox infrastructure unavailable')
        return
      }

      console.log(`[Judge] Task completed: submission=${submissionId}, result=${result.result}`)
      judgeTelemetry.finishTask('submission', result.result, telemetryStartedAt)

      const resultMsg: ResultMessage = {
        type: 'result',
        payload: {
          ...result,
          judgeRunId,
          judgeAttemptId,
          fencingToken,
          phaseMetrics: {
            ...result.phaseMetrics,
            dispatchMs: typeof dispatchedAt === 'number' ? Math.max(0, receivedAt - dispatchedAt) : undefined,
            judgeTotalMs: Math.max(0, Math.round(performance.now() - judgeStartedAt)),
            runMs: Math.max(0, Math.round(performance.now() - judgeStartedAt) - (result.phaseMetrics?.compileMs || 0)),
          },
        }
      }
      this.send(resultMsg)
    } catch (e: any) {
      judgeTelemetry.finishTask('submission', 'system_error', telemetryStartedAt)
      console.error(`[Judge] Task failed: submission=${submissionId}`, e.message)

      const resultMsg: ResultMessage = {
        type: 'result',
        payload: {
          submissionId,
          judgeRunId,
          judgeAttemptId,
          fencingToken,
          result: 'System Error',
          time: 0,
          memory: 0,
          score: 0,
          cases: [],
          message: e.message,
          phaseMetrics: {
            dispatchMs: typeof dispatchedAt === 'number' ? Math.max(0, receivedAt - dispatchedAt) : undefined,
            judgeTotalMs: Math.max(0, Math.round(performance.now() - judgeStartedAt)),
          }
        }
      }
      this.send(resultMsg)
    }
  }

  private send(msg: WSMessage) {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.send({ type: 'ping', payload: {} })
      }
    }, 30 * 1000) // 每 30 秒发送心跳
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    this.reconnectTimer = setTimeout(() => {
      console.log('[Judge] Reconnecting...')
      this.connect()
    }, 5000)
  }

  disconnect() {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.isConnected = false
    judgeTelemetry.setConnection(false)
  }
}

export const client = new JudgeClient()
