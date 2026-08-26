import dotenv from 'dotenv'
import path from 'path'
import { setGlobalDispatcher, Agent } from 'undici'
import { validateEnv } from './config/env'
import logger from './lib/logger'
import { prisma } from './prisma'
import { proxyManager } from './lib/browser/proxy'
import { browserManager } from './lib/browser/manager'
import { acquireBackgroundWorkerLock } from './lib/background-worker-lock'
import { startBackgroundServices } from './lib/background-services'

const envFile = process.env.ENV_FILE || (process.env.NODE_ENV === 'production' ? '.env.production' : '.env')
dotenv.config({ path: path.resolve(process.cwd(), envFile) })
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))
validateEnv()
proxyManager.loadFromEnv()

async function main() {
  const lock = await acquireBackgroundWorkerLock()
  const services = startBackgroundServices()
  const heartbeat = setInterval(() => {
    logger.info('background_worker_heartbeat', { action: 'background_worker' })
  }, 300_000)
  heartbeat.unref()
  logger.info('background_worker_started', { action: 'background_worker', metadata: { pid: process.pid } })

  let shutdownPromise: Promise<void> | null = null
  const shutdown = (signal: string) => {
    if (shutdownPromise) return shutdownPromise
    shutdownPromise = (async () => {
      logger.info('background_worker_shutting_down', { action: 'background_worker', metadata: { signal } })
      clearInterval(heartbeat)
      await services.stop()
      await browserManager.close()
      await lock.release()
      await prisma.$disconnect()
      logger.info('background_worker_stopped', { action: 'background_worker' })
    })()
    return shutdownPromise
  }

  process.once('SIGTERM', () => { void shutdown('SIGTERM').finally(() => process.exit(0)) })
  process.once('SIGINT', () => { void shutdown('SIGINT').finally(() => process.exit(0)) })
}

main().catch(async error => {
  logger.error('background_worker_start_failed', error, { action: 'background_worker' })
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
