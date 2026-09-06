/**
 * 定时任务：扫描 code 为空的 CF 提交，通过 Playwright 抓取源代码
 */

import cron from 'node-cron'
import { fetchMissingCfCodes } from './cf-code-fetcher'
import logger from './logger'
import { collectOrphanTestdataObjects } from './testdata-object-gc'
import { collectOrphanContentBlobs, releaseBlobReferences } from '../modules/storage/content-blob.service'
import { prisma } from '../prisma'
import { runChatMaintenance } from '../modules/chat/application/chat-maintenance.service'
import { expireStagedStickerImports } from '../modules/chat/application/chat-sticker.service'

async function expireCandidateData() {
  const now = new Date(), rejectedBefore = new Date(Date.now() - 24 * 60 * 60_000)
  const candidates = await prisma.testcaseCandidate.findMany({ where: { promotedRevisionId: null, OR: [{ expiresAt: { lte: now } }, { status: { in: ['REJECTED', 'REDUNDANT', 'FAILED', 'STALE'] }, updatedAt: { lte: rejectedBefore } }] }, take: 500, select: { id: true } })
  for (const item of candidates) {
    await releaseBlobReferences('testcase_candidate', item.id)
    await prisma.testcaseCandidate.updateMany({ where: { id: item.id, promotedRevisionId: null }, data: { status: 'EXPIRED', inputObjectId: null, outputObjectId: null, evaluationStage: 'metadata_only' } })
  }
  return { expired: candidates.length }
}

let isRunning = false
let cronStopper: (() => void) | null = null

export function startCronTasks() {
  if (cronStopper) {
    logger.warn('cron_tasks_already_running', { action: 'cron_start' })
    return cronStopper
  }
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

  // Content-addressed uploads may be left behind when a Revision transaction
  // loses CAS or rolls back. Remove only objects older than 24 hours and still
  // unreferenced, under the same per-problem database lock as publishers.
  const gcTask = cron.schedule('17 3 * * *', async () => {
    try {
      const result = await collectOrphanTestdataObjects()
      logger.info('testdata_object_gc_done', { action: 'testdata_object_gc', metadata: result })
      const lifecycle = await expireCandidateData()
      const blobs = await collectOrphanContentBlobs()
      logger.info('candidate_blob_gc_done', { action: 'candidate_blob_gc', metadata: { ...lifecycle, ...blobs } })
    } catch (error) {
      logger.error('testdata_object_gc_error', { action: 'testdata_object_gc', metadata: { error: (error as Error).message } })
    }
  })

  const chatTask = cron.schedule('23 * * * *', async () => {
    try {
      const result = await runChatMaintenance()
      const expiredStickerImports = await expireStagedStickerImports()
      logger.info('chat_maintenance_done', { action: 'chat_maintenance', metadata: { ...result, expiredStickerImports } })
    } catch (error) {
      logger.error('chat_maintenance_failed', error as Error, { action: 'chat_maintenance' })
    }
  })

  logger.info('cron_tasks_started', { action: 'cron_start' })
  cronStopper = () => {
    task.stop()
    gcTask.stop()
    chatTask.stop()
    cronStopper = null
    logger.info('cron_tasks_stopped', { action: 'cron_stop' })
  }
  return cronStopper
}
