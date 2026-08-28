import { startCronTasks } from './cron-tasks'
import { startSubmissionPoller, stopSubmissionPoller } from './submission-poller'
import { startAutoVerifyScheduler } from '../modules/oj-account/application/oj-account.service'
import logger from './logger'

export interface BackgroundServicesHandle {
  stop(): Promise<void>
}

export function startSchedulerServices(): BackgroundServicesHandle {
  const stopCronTasks = startCronTasks()
  const stopAutoVerify = startAutoVerifyScheduler()
  logger.info('scheduler_services_started', { action: 'background_scheduler' })

  let stopped = false
  return {
    async stop() {
      if (stopped) return
      stopped = true
      stopAutoVerify()
      stopCronTasks()
      logger.info('scheduler_services_stopped', { action: 'background_scheduler' })
    },
  }
}

export function startExecutorServices(): BackgroundServicesHandle {
  startSubmissionPoller(5000)
  logger.info('executor_services_started', { action: 'background_executor' })
  let stopped = false
  return {
    async stop() {
      if (stopped) return
      stopped = true
      stopSubmissionPoller()
      logger.info('executor_services_stopped', { action: 'background_executor' })
    },
  }
}

/** Compatibility composition for isolated tests and one-process development. */
export function startBackgroundServices(): BackgroundServicesHandle {
  const scheduler = startSchedulerServices()
  const executor = startExecutorServices()
  return { async stop() { await executor.stop(); await scheduler.stop() } }
}
