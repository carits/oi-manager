import type { Response } from 'express'
import { Client } from 'pg'
import logger from '../../lib/logger'
import { prisma } from '../../prisma'
import { eventBacklog } from './application/chat.service'
import { chatMetrics } from './chat-metrics'

type Stream = { response: Response; cursor: bigint; closed: boolean; flushing: boolean; pending: boolean }

class ChatRealtimeHub {
  private streams = new Map<string, Set<Stream>>()
  private listener: Client | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeat: NodeJS.Timeout | null = null
  private stopping = false

  async start() {
    this.stopping = false
    await this.connectListener()
    this.heartbeat = setInterval(() => {
      void this.heartbeatTick().catch(error => logger.error('chat_heartbeat_failed', error as Error, { action: 'chat_sse' }))
    }, 20_000)
    this.heartbeat.unref()
  }

  private async connectListener() {
    if (this.stopping || !process.env.DATABASE_URL) return
    const listener = new Client({ connectionString: process.env.DATABASE_URL, application_name: 'oi-manager-chat-events' })
    listener.on('notification', notification => {
      try {
        const payload = JSON.parse(notification.payload || '{}')
        if (typeof payload.userId === 'string') void this.flushUser(payload.userId).catch(error => logger.error('chat_event_flush_failed', error as Error, { action: 'chat_sse', metadata: { userId: payload.userId } }))
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
    listener.on('end', () => {
      if (this.listener === listener) this.listener = null
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
      chatMetrics.reconnect()
      void this.connectListener()
    }, 2_000)
    this.reconnectTimer.unref()
  }

  async add(userId: string, response: Response, cursor: bigint) {
    const stream: Stream = { response, cursor, closed: false, flushing: false, pending: false }
    const set = this.streams.get(userId) || new Set<Stream>()
    if (set.size >= 8) throw new Error('CHAT_STREAM_LIMIT')
    set.add(stream)
    chatMetrics.connectionOpened()
    this.streams.set(userId, set)
    response.once('close', () => this.remove(userId, stream))
    await this.flush(userId, stream)
  }

  private async heartbeatTick() {
    const userIds = [...this.streams.keys()]
    if (!userIds.length) return
    const activeUsers = new Set((await prisma.user.findMany({ where: { id: { in: userIds }, status: 'active' }, select: { id: true } })).map(user => user.id))
    for (const [userId, streams] of this.streams) for (const stream of [...streams]) {
      if (stream.closed) continue
      try {
        if (!activeUsers.has(userId)) {
          stream.response.write('event: auth_revoked\ndata: {}\n\n')
          stream.response.end()
          this.remove(userId, stream)
        } else stream.response.write(': heartbeat\n\n')
      } catch (error) {
        logger.warn('chat_stream_heartbeat_write_failed', { action: 'chat_sse', metadata: { userId, error: String(error) } })
        this.remove(userId, stream)
      }
    }
  }

  async refreshAll() {
    const results = await Promise.allSettled([...this.streams.keys()].map(userId => this.flushUser(userId)))
    for (const result of results) if (result.status === 'rejected') logger.error('chat_event_catchup_user_failed', result.reason as Error, { action: 'chat_sse' })
  }

  private remove(userId: string, stream: Stream) {
    if (stream.closed) return
    stream.closed = true
    const set = this.streams.get(userId)
    set?.delete(stream)
    if (!set?.size) this.streams.delete(userId)
    chatMetrics.connectionClosed()
  }

  private async flushUser(userId: string) {
    const streams = this.streams.get(userId)
    if (!streams) return
    const results = await Promise.allSettled([...streams].map(stream => this.flush(userId, stream)))
    for (const result of results) if (result.status === 'rejected') logger.error('chat_event_stream_flush_failed', result.reason as Error, { action: 'chat_sse', metadata: { userId } })
  }

  private async flush(userId: string, stream: Stream) {
    if (stream.closed) return
    if (stream.flushing) { stream.pending = true; return }
    stream.flushing = true
    try {
      do {
        stream.pending = false
        const events = await eventBacklog(userId, stream.cursor)
        chatMetrics.backlog(events.length)
        for (const event of events) {
          if (stream.closed) return
          stream.response.write(`id: ${event.id.toString()}\n`)
          stream.response.write(`event: ${event.eventType}\n`)
          stream.response.write(`data: ${JSON.stringify({ eventType: event.eventType, conversationId: event.conversationId, messageId: event.messageId, payload: event.payload, createdAt: event.createdAt })}\n\n`)
          stream.cursor = event.id
        }
        if (events.length === 200) stream.pending = true
      } while (stream.pending && !stream.closed)
    } catch (error) {
      chatMetrics.flushFailure()
      this.remove(userId, stream)
      try { stream.response.end() } catch { /* stream already closed */ }
      throw error
    } finally {
      stream.flushing = false
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
