import dotenv from 'dotenv'
import path from 'path'
import { Agent, setGlobalDispatcher } from 'undici'
import { validateEnv } from './config/env'
import { browserManager } from './lib/browser/manager'
import { proxyManager } from './lib/browser/proxy'
import { startExecutorServices } from './lib/background-services'
import logger from './lib/logger'
import { prisma } from './prisma'

const envFile = process.env.ENV_FILE || (process.env.NODE_ENV === 'production' ? '.env.production' : '.env')
dotenv.config({ path: path.resolve(process.cwd(), envFile) })
setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))
validateEnv()
proxyManager.loadFromEnv()

async function main() {
  const instance = process.env.EXECUTOR_INSTANCE || String(process.pid)
  const services = startExecutorServices()
  const heartbeat = setInterval(() => {
    logger.info('background_executor_heartbeat', { action: 'background_executor', metadata: { instance } })
  }, 300_000)
  logger.info('background_executor_started', { action: 'background_executor', metadata: { instance, pid: process.pid } })

  let shutdownPromise: Promise<void> | null = null
  const shutdown = (signal: string) => {
    if (shutdownPromise) return shutdownPromise
    shutdownPromise = (async () => {
      logger.info('background_executor_shutting_down', { action: 'background_executor', metadata: { signal, instance } })
      clearInterval(heartbeat)
      await services.stop()
      await browserManager.close()
      await prisma.$disconnect()
      logger.info('background_executor_stopped', { action: 'background_executor', metadata: { instance } })
    })()
    return shutdownPromise
  }

  process.once('SIGTERM', () => { void shutdown('SIGTERM').finally(() => process.exit(0)) })
  process.once('SIGINT', () => { void shutdown('SIGINT').finally(() => process.exit(0)) })
}

main().catch(async error => {
  logger.error('background_executor_start_failed', error, { action: 'background_executor' })
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
