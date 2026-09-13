import type { Application } from 'express'
import type { Server } from 'node:http'
import { chatRealtimeHub } from './modules/chat/chat-realtime'
import { browserManager } from './lib/browser/manager'
import logger from './lib/logger'
import { metrics } from './lib/metrics'
import { prisma } from './prisma'
import { drainJudgeWebSocket, initJudgeWebSocket } from './ws/judge'

let shutdownPromise: Promise<void> | null = null

export function startServerRuntime(app: Application): Server {
  const port = Number.parseInt(process.env.PORT || '3002', 10)
  const host = process.env.API_HOST || '127.0.0.1'
  const httpServer = app.listen(port, host, () => {
    logger.info('server_started', {
      action: 'server_start',
      metadata: { host, port, env: process.env.NODE_ENV || 'development' },
    })
    metrics.startPeriodicLog(300000)
    initJudgeWebSocket(httpServer)
    void chatRealtimeHub.start().catch(error => {
      logger.error('chat_realtime_start_failed', error, { action: 'server_start' })
    })
    const chatEventCatchup = setInterval(() => {
      void chatRealtimeHub.refreshAll().catch(error => {
        logger.error('chat_event_catchup_failed', error, { action: 'chat_sse' })
      })
    }, 30_000)
    chatEventCatchup.unref()
    httpServer.once('close', () => clearInterval(chatEventCatchup))
  })

  const gracefulShutdown = async (signal: string) => {
    if (shutdownPromise) return shutdownPromise
    shutdownPromise = (async () => {
      logger.info('server_shutting_down', { action: 'server_shutdown', metadata: { signal } })
      await chatRealtimeHub.stop().catch(error => {
        logger.error('chat_realtime_drain_failed', error, { action: 'server_shutdown' })
      })
      await drainJudgeWebSocket(Number.parseInt(process.env.API_DRAIN_TIMEOUT_MS || '30000', 10)).catch(error => {
        logger.error('judge_drain_failed', error, { action: 'server_shutdown' })
      })
      await browserManager.close()
      await new Promise<void>(resolve => httpServer.close(() => resolve()))
      metrics.stopPeriodicLog()
      await prisma.$disconnect()
      process.exit(0)
    })()
    return shutdownPromise
  }

  process.once('SIGTERM', () => void gracefulShutdown('SIGTERM'))
  process.once('SIGINT', () => void gracefulShutdown('SIGINT'))
  process.once('SIGUSR2', () => void gracefulShutdown('SIGUSR2'))
  process.on('uncaughtExceptionMonitor', error => {
    logger.error('process_uncaught_exception', error, { action: 'process_failure' })
    metrics.flushSnapshot()
  })
  process.on('unhandledRejection', reason => {
    logger.error('process_unhandled_rejection', reason, { action: 'process_failure' })
    metrics.flushSnapshot()
    process.exit(1)
  })

  return httpServer
}
