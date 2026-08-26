import { startCronTasks } from './cron-tasks'
import { startSubmissionPoller, stopSubmissionPoller } from './submission-poller'
import { startAutoVerifyScheduler } from '../routes/oj-accounts'
import logger from './logger'

export interface BackgroundServicesHandle {
  stop(): Promise<void>
}

export function startBackgroundServices(): BackgroundServicesHandle {
  const stopCronTasks = startCronTasks()
  const stopAutoVerify = startAutoVerifyScheduler()
  startSubmissionPoller(5000)
  logger.info('background_services_started', { action: 'background_worker' })

  let stopped = false
  return {
    async stop() {
      if (stopped) return
      stopped = true
      stopSubmissionPoller()
      stopAutoVerify()
      stopCronTasks()
      logger.info('background_services_stopped', { action: 'background_worker' })
    },
  }
}
