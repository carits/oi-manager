/**
 * WebSocket 客户端
 *
 * 连接后端，接收评测任务，返回评测结果
 */

import WebSocket from 'ws'
import { config } from './config'
import { judge } from './judge'
import type { JudgeMessage, ResultMessage, RegisterMessage, WSMessage } from './types'

class JudgeClient {
  private ws: WebSocket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private isConnected = false

  connect() {
    const url = `${config.backendUrl}/ws/judge`

    console.log(`[Judge] Connecting to ${url}...`)

    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      console.log('[Judge] Connected to backend')
      this.isConnected = true

      // 注册评测机
      const registerMsg: RegisterMessage = {
        type: 'register',
        payload: {
          judgeId: config.judgeId,
          languages: ['c', 'c11', 'cpp', 'cpp11', 'cpp14', 'cpp17', 'cpp20']
        }
      }
      this.send(registerMsg)
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
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      console.error('[Judge] WebSocket error:', err.message)
    })
  }

  private async handleMessage(msg: WSMessage) {
    switch (msg.type) {
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

    console.log(`[Judge] Received task: submission=${submissionId}, problem=${problemId}, lang=${language}`)

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