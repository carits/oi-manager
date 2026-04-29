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
import type { JudgeMessage, ResultMessage, RegisterMessage, WSMessage } from './types'

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

    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      console.log('[Judge] Connected to backend')
      this.isConnected = true

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
        console.error('[Judge] Failed to parse message:', e.message)
      }
    })

    this.ws.on('close', () => {
      console.log('[Judge] Disconnected from backend')
      this.isConnected = false
      this.isAuthenticated = false
      this.judgeId = null
      this.stopHeartbeat()
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      console.error('[Judge] WebSocket error:', err.message)
    })
  }

  private register() {
    // 注册评测机
    const registerMsg: RegisterMessage = {
      type: 'register',
      payload: {
        judgeId: config.judgeId,
        languages: ['c', 'c11', 'cpp', 'cpp11', 'cpp14', 'cpp17', 'cpp20']
      }
    }
    this.send(registerMsg)
  }

  private async handleMessage(msg: WSMessage) {
    switch (msg.type) {
      case 'auth_success':
        console.log('[Judge] Authentication successful')
        this.isAuthenticated = true
        this.register()
        break
      case 'error':
        console.error('[Judge] Server error:', msg.payload?.message)
        if (msg.payload?.message?.includes('token') || msg.payload?.message?.includes('auth')) {
          this.isAuthenticated = false
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
      case 'ping':
        // 服务端心跳请求，响应 pong
        this.send({ type: 'pong', payload: {} })
        break
      case 'judge':
        await this.handleJudgeTask(msg as JudgeMessage)
        break
      default:
        console.log('[Judge] Unknown message type:', msg.type)
    }
  }

  private async handleJudgeTask(msg: JudgeMessage) {
    const { submissionId, problemId, code, language, config, testdataPath } = msg.payload

    console.log(`[Judge] Received task: submission=${submissionId}, problem=${problemId}, lang=${language}`)

    // 直接执行评测任务（无 PQueue，并发由服务端 Consumer 控制）
    try {
      const result = await judge({
        submissionId,
        problemId,
        code,
        language,
        config: config,
        testdataPath
      })

      console.log(`[Judge] Task completed: submission=${submissionId}, result=${result.result}`)

      const resultMsg: ResultMessage = {
        type: 'result',
        payload: result
      }
      this.send(resultMsg)
    } catch (e: any) {
      console.error(`[Judge] Task failed: submission=${submissionId}`, e.message)

      const resultMsg: ResultMessage = {
        type: 'result',
        payload: {
          submissionId,
          result: 'System Error',
          time: 0,
          memory: 0,
          score: 0,
          cases: [],
          message: e.message
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
  }
}

export const client = new JudgeClient()