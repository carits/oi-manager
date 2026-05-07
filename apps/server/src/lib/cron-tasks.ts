/**
 * 定时任务：扫描 code 为空的 CF 提交，通过 Playwright 抓取源代码
 */

import cron from 'node-cron'
import { fetchMissingCfCodes } from './cf-code-fetcher'
import logger from './logger'

let isRunning = false

export function startCronTasks() {
  // 每 1 分钟扫描一次 code 为空的 CF 提交，每次最多抓取 20 条
  const task = cron.schedule('* * * * *', async () => {
    if (isRunning) {
      logger.info('cron_cf_code_fetch_skip', {
        action: 'cron_cf_code_fetch',
        metadata: { reason: 'previous_run_still_active' },
      })
      return
    }

    isRunning = true
    logger.info('cron_cf_code_fetch_start', { action: 'cron_cf_code_fetch' })

    try {
      const result = await fetchMissingCfCodes(20)
      logger.info('cron_cf_code_fetch_done', {
        action: 'cron_cf_code_fetch',
        metadata: result,
      })
    } catch (error) {
      logger.error('cron_cf_code_fetch_error', {
        action: 'cron_cf_code_fetch',
        metadata: { error: (error as Error).message },
      })
    } finally {
      isRunning = false
    }
  })

  logger.info('cron_tasks_started', { action: 'cron_start' })
  return task
}
