/**
 * 提交结果轮询器
 * 定期检查未完成的提交，更新评测结果
 */

import { prisma } from '../prisma'
import { logger } from './logger'
import { pollHduResult } from './hdu-submit'

let pollInterval: NodeJS.Timeout | null = null

/**
 * 启动轮询器
 */
export function startSubmissionPoller(intervalMs: number = 5000) {
  if (pollInterval) {
    logger.warn('poller_already_running', { action: 'poller' })
    return
  }

  logger.info('poller_started', {
    action: 'poller',
    metadata: { intervalMs },
  })

  pollInterval = setInterval(async () => {
    try {
      await pollPendingSubmissions()
    } catch (e: any) {
      logger.error('poller_error', {
        action: 'poller',
        metadata: { error: e.message },
      })
    }
  }, intervalMs)
}

/**
 * 停止轮询器
 */
export function stopSubmissionPoller() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
    logger.info('poller_stopped', { action: 'poller' })
  }
}

/**
 * 轮询未完成的提交
 */
async function pollPendingSubmissions() {
  // 查询正在排队或评测中的提交
  const pendingSubmissions = await prisma.submission.findMany({
    where: {
      result: 'queuing',
      ojRemoteId: { not: null },
    },
    include: {
      OjAccount: true,
    },
    take: 10, // 每次最多处理 10 个
  })

  if (pendingSubmissions.length === 0) {
    return
  }

  logger.info('poller_pending_count', {
    action: 'poller',
    metadata: { count: pendingSubmissions.length },
  })

  for (const submission of pendingSubmissions) {
    if (!submission.OjAccount || !submission.ojRemoteId) {
      continue
    }

    try {
      const result = await pollHduResult(
        {
          username: submission.OjAccount.username,
          password: submission.OjAccount.password!,
          passwordIV: submission.OjAccount.passwordIV!,
          cookie: submission.OjAccount.cookie,
        },
        submission.ojRemoteId
      )

      if (result && result.result !== 'queuing') {
        // 更新提交记录
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            result: result.result,
            timeUsed: result.timeUsed,
            memoryUsed: result.memoryUsed,
          },
        })

        logger.info('poller_result_updated', {
          action: 'poller',
          metadata: {
            submissionId: submission.id,
            result: result.result,
            timeUsed: result.timeUsed,
            memoryUsed: result.memoryUsed,
          },
        })
      }
    } catch (e: any) {
      logger.error('poller_submission_error', {
        action: 'poller',
        metadata: { submissionId: submission.id, error: e.message },
      })
    }
  }
}