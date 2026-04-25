/**
 * WebSocket 客户端
 *
 * 连接后端，接收评测任务，返回评测结果
 */

import WebSocket from 'ws'
import PQueue from 'p-queue'
import { config } from './config'
import { judge } from './judge'
import type { JudgeMessage, ResultMessage, RegisterMessage, WSMessage } from './types'

class JudgeClient {
  private ws: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private isConnected = false
  private isAuthenticated = false
  // 并发队列：限制同时运行的评测任务数
  private queue = new PQueue({ concurrency: config.maxConcurrent })

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
      case 'judge':
        await this.handleJudgeTask(msg as JudgeMessage)
        break
      case 'registered':
        // 服务端确认注册成功
        console.log('[Judge] Registration confirmed by backend')
        break
      case 'ping':
        this.send({ type: 'pong', payload: {} })
        break
      default:
        console.log('[Judge] Unknown message type:', msg.type)
    }
  }

  private async handleJudgeTask(msg: JudgeMessage) {
    const { submissionId, problemId, code, language, config: problemConfig, testdataPath } = msg.payload

    console.log(`[Judge] Received task: submission=${submissionId}, problem=${problemId}, lang=${language}, queue_size=${this.queue.size}, pending=${this.queue.pending}`)

    // 使用并发队列处理任务
    this.queue.add(async () => {
      try {
        const result = await judge({
          submissionId,
          problemId,
          code,
          language,
          config: problemConfig,
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
    }).catch(() => {}) // p-queue 内部错误已在 add 的回调中处理，这里忽略外层错误
  }

  private send(msg: WSMessage) {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(msg))
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