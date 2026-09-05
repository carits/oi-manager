import type { Response } from 'express'
import { Client } from 'pg'
import logger from '../../lib/logger'
import { prisma } from '../../prisma'
import { eventBacklog, isEventCursorExpired } from './application/chat.service'

type Stream = { response: Response; cursor: bigint; closed: boolean }

class ChatRealtimeHub {
  private streams = new Map<string, Set<Stream>>()
  private listener: Client | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private stopping = false

  async start() {
    this.stopping = false
    await this.connectListener()
    this.heartbeat = setInterval(() => void this.heartbeatTick(), 20_000)
    this.heartbeat.unref()
  }

  private async connectListener() {
    if (this.stopping || !process.env.DATABASE_URL) return
    const listener = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'oi-manager-chat-events' })
    listener.on('notification', notification => {
      try {
        const payload = JSON.parse(notification.payload || '{}')
        if (typeof payload.userId === 'string') void this.flushUser(payload.userId)
      } catch (error) {
        logger.warn('chat_event_notification_invalid', { action: 'chat_sse', metadata: { error: String(error) } })
      }
    })
    listener.on('error', error => {
      logger.error('chat_event_listener_error', error, { action: 'chat_sse' })
      if (this.listener === listener) this.listener = null
      void listener.end().catch(() => undefined)
      this.scheduleReconnect()
    })
    try {
      await listener.connect()
      await listener.query('LISTEN chat_user_events')
      this.listener = listener
      logger.info('chat_event_listener_ready', { action: 'chat_sse' })
    } catch (error) {
      logger.error('chat_event_listener_connect_failed', error as Error, { action: 'chat_sse' })
      await listener.end().catch(() => undefined)
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connectListener()
    }, 2_000)
    this.reconnectTimer.unref()
  }

  async add(userId: string, response: Response, cursor: bigint) {
    const stream: Stream = { response, cursor, closed: false }
    const set = this.streams.get(userId) || new Set<Stream>()
    if (set.size >= 8) throw new Error('CHAT_STREAM_LIMIT')
    set.add(stream)
    this.streams.set(userId, set)
    response.once('close', () => this.remove(userId, stream))
    if (await isEventCursorExpired(userId, cursor)) response.write('event: resync_required\ndata: {}\n\n')
    await this.flush(userId, stream)
  }

  private async heartbeatTick() {
    const userIds = [...this.streams.keys()]
    if (!userIds.length) return
    const activeUsers = new Set((await prisma.user.findMany({ where: { id: { in: userIds }, status: 'active' }, select: { id: true } })).map(user => user.id))
    for (const [userId, streams] of this.streams) for (const stream of streams) {
      if (stream.closed) continue
      if (!activeUsers.has(userId)) {
        stream.response.write('event: auth_revoked\ndata: {}\n\n')
        stream.response.end()
      } else stream.response.write(': heartbeat\n\n')
    }
  }

  async refreshAll() {
    await Promise.all([...this.streams.keys()].map(userId => this.flushUser(userId)))
  }

  private remove(userId: string, stream: Stream) {
    stream.closed = true
    const set = this.streams.get(userId)
    set?.delete(stream)
    if (!set?.size) this.streams.delete(userId)
  }

  private async flushUser(userId: string) {
    const streams = this.streams.get(userId)
    if (!streams) return
    await Promise.all([...streams].map(stream => this.flush(userId, stream)))
  }

  private async flush(userId: string, stream: Stream) {
    if (stream.closed) return
    const events = await eventBacklog(userId, stream.cursor)
    for (const event of events) {
      if (stream.closed) return
      stream.response.write(`id: ${event.id.toString()}\n`)
      stream.response.write(`event: ${event.eventType}\n`)
      stream.response.write(`data: ${JSON.stringify({ eventType: event.eventType, conversationId: event.conversationId, messageId: event.messageId, payload: event.payload, createdAt: event.createdAt })}\n\n`)
      stream.cursor = event.id
    }
  }

  async stop() {
    this.stopping = true
    if (this.heartbeat) clearInterval(this.heartbeat)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    for (const streams of this.streams.values()) for (const stream of streams) {
      if (!stream.closed) {
        stream.response.write('event: service_restart\ndata: {}\n\n')
        stream.response.end()
      }
    }
    this.streams.clear()
    const listener = this.listener
    this.listener = null
    if (listener) await listener.end().catch(() => undefined)
  }
}

export const chatRealtimeHub = new ChatRealtimeHub()
