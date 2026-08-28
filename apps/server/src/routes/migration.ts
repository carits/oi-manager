import { Router } from 'express'
import { logger } from '../lib/logger'
import { authenticate, authorize } from '../middleware/auth'
import {
  migrateLegacyProblemStatuses,
  migrateLegacySubmissionScopes,
} from '../modules/maintenance/application/legacy-submission-migration.service'

export const migrationRouter = Router()

migrationRouter.use(authenticate, authorize('super_admin'), (_req, res, next) => {
  if (process.env.ENABLE_MAINTENANCE_API !== 'true') {
    return res.status(404).json({ success: false, message: '接口不存在' })
  }
  next()
})

migrationRouter.post('/migrate-submission-scope', async (_req, res) => {
  try {
    logger.info('migration_submission_scope_started', { action: 'migration' })
    const data = await migrateLegacySubmissionScopes()
    logger.info('migration_submission_scope_completed', { action: 'migration', metadata: data })
    return res.json({
      success: true,
      data: {
        ...data,
        message: data.migrated
          ? `成功迁移 ${data.migrated} 条提交（比赛: ${data.contestCount}, 训练: ${data.trainingCount}）`
          : '没有需要迁移的提交',
      },
    })
  } catch (error: any) {
    logger.error('migration_submission_scope_error', { action: 'migration', metadata: { error: error.message } })
    return res.status(500).json({ success: false, message: error.message })
  }
})

migrationRouter.post('/migrate-problem-status', async (_req, res) => {
  try {
    logger.info('migration_problem_status_started', { action: 'migration' })
    const data = await migrateLegacyProblemStatuses()
    logger.info('migration_problem_status_completed', { action: 'migration', metadata: data })
    return res.json({
      success: true,
      data: {
        ...data,
        message: `创建了 ${data.trainingStatusCreated} 条训练状态记录，${data.contestStatusCreated} 条比赛状态记录`,
      },
    })
  } catch (error: any) {
    logger.error('migration_problem_status_error', { action: 'migration', metadata: { error: error.message } })
    return res.status(500).json({ success: false, message: error.message })
  }
})
