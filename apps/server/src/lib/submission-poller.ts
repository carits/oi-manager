/**
 * 提交结果轮询器
 * 定期检查未完成的提交，更新评测结果
 */

import { prisma } from '../prisma'
import { logger } from './logger'
import { pollHduResult } from './hdu-submit'
import { pollCfResultPlaywright, pollCfResultByApi } from './cf-submit'
import { tryAcquireExecutorTaskLease } from './executor-task-lease'

let pollInterval: NodeJS.Timeout | null = null
let isPolling = false

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
    if (isPolling) {
      logger.info('poller_skip', { action: 'poller', metadata: { reason: 'previous_run_still_active' } })
      return
    }
    isPolling = true
    try {
      await pollPendingSubmissions()
    } catch (e: any) {
      logger.error('poller_error', {
        action: 'poller',
        metadata: { error: e.message },
      })
    } finally {
      isPolling = false
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
      // Only legacy remote code submissions are polled. Local and archive
      // records have independent lifecycles.
      submitMethod: { in: ['robot', 'myAccount'] },
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
    if (!submission.ojRemoteId) {
      continue
    }

    const lease = await tryAcquireExecutorTaskLease('legacy-remote-submission-poll', submission.id)
    if (!lease) continue
    try {
      // HDU 提交轮询（需要 OjAccount）
      if (submission.oj === 'hdu' && submission.OjAccount) {
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
          // HDU ACM 赛制：AC=100分，否则0分
          const score = result.result === 'accepted' ? 100 : 0

          // 更新提交记录
          await prisma.submission.update({
            where: { id: submission.id },
            data: {
              result: result.result,
              timeUsed: result.timeUsed,
              memoryUsed: result.memoryUsed,
              score,
            },
          })

          logger.info('poller_hdu_result_updated', {
            action: 'poller',
            metadata: {
              submissionId: submission.id,
              result: result.result,
              timeUsed: result.timeUsed,
              memoryUsed: result.memoryUsed,
              score,
            },
          })
        }
      }

      // Codeforces 提交轮询（使用 CF API）
      if (submission.oj === 'codeforces') {
        // 获取用户绑定的 CF 账号
        const binding = await prisma.userPlatformBinding.findFirst({
          where: {
            userId: submission.userId,
            platform: 'codeforces',
          }
        })

        if (binding?.bindingData) {
          const { handle } = JSON.parse(binding.bindingData)

          try {
            // 使用新的 API 轮询方法
            const result = await pollCfResultByApi(handle, submission.ojRemoteId)

            if (result.done) {
              // CF OI 赛制：分数由评测系统给出（暂不计算）
              const score = result.result === 'accepted' ? 100 : 0

              // 更新提交记录
              await prisma.submission.update({
                where: { id: submission.id },
                data: {
                  result: result.result,
                  timeUsed: result.timeUsed,
                  memoryUsed: result.memoryUsed,
                  score,
                },
              })

              logger.info('poller_cf_result_updated', {
                action: 'poller',
                metadata: {
                  submissionId: submission.id,
                  result: result.result,
                  timeUsed: result.timeUsed,
                  memoryUsed: result.memoryUsed,
                  score,
                },
              })
            }
          } catch (apiError: any) {
            // API 失败时回退到 Playwright
            logger.warn('cf_api_fallback_to_playwright', {
              action: 'poller',
              metadata: { submissionId: submission.id, error: apiError.message }
            })

            const { jsessionid } = JSON.parse(binding.bindingData)
            const result = await pollCfResultPlaywright(jsessionid, submission.ojRemoteId)

            if (result && result.result !== 'queuing' && result.result !== 'judging') {
              const score = result.result === 'accepted' ? 100 : 0

              await prisma.submission.update({
                where: { id: submission.id },
                data: {
                  result: result.result,
                  timeUsed: result.timeUsed,
                  memoryUsed: result.memoryUsed,
                  score,
                },
              })

              logger.info('poller_cf_result_updated_playwright', {
                action: 'poller',
                metadata: {
                  submissionId: submission.id,
                  result: result.result,
                  timeUsed: result.timeUsed,
                  memoryUsed: result.memoryUsed,
                  testCount: result.testCount,
                  score,
                },
              })
            }
          }
        }
      }

      // 其他平台暂不支持轮询
    } catch (e: any) {
      logger.error('poller_submission_error', {
        action: 'poller',
        metadata: { submissionId: submission.id, error: e.message },
      })
    } finally {
      await lease.release()
    }
  }
}
