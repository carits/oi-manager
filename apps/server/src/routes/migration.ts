import { Router } from 'express'
import { logger } from '../lib/logger'
import { authenticate, authorize } from '../middleware/auth'
import {
  migrateLegacyProblemStatuses,
  migrateLegacySubmissionScopes,
} from '../modules/maintenance/application/legacy-submission-migration.service'
import { applyOrganizationJoinMigration, inspectOrganizationJoinMigration } from '../modules/maintenance/application/organization-join-migration.service'
import { applySchoolNameKeyMigration, inspectSchoolNameKeyMigration } from '../modules/maintenance/application/school-name-key-migration.service'
import { applySchoolDirectoryStatusMigration, inspectSchoolDirectoryStatusMigration } from '../modules/maintenance/application/school-directory-status-migration.service'
import { applyJudgeProgramProtocolMigration, inspectJudgeProgramProtocolMigration } from '../modules/maintenance/application/judge-program-protocol-migration.service'
import { applyTrainingEngineMigration, inspectTrainingEngineMigration } from '../modules/maintenance/application/training-engine-migration.service'
import { applyEconomyLoopMigration, inspectEconomyLoopMigration } from '../modules/maintenance/application/economy-loop-migration.service'
import { applyAssignmentMigration, inspectAssignmentMigration } from '../modules/maintenance/application/assignment-migration.service'

export const migrationRouter = Router()

migrationRouter.use(authenticate, authorize('super_admin'), (_req, res, next) => {
  if (process.env.ENABLE_MAINTENANCE_API !== 'true') {
    return res.status(404).json({ success: false, message: '接口不存在' })
  }
  next()
})

migrationRouter.get('/economy-loop', async (_req, res) => {
  try { return res.json({ success: true, data: await inspectEconomyLoopMigration() }) }
  catch (error: any) { return res.status(500).json({ success: false, message: error.message }) }
})

migrationRouter.post('/economy-loop', async (req, res) => {
  try { return res.json({ success: true, data: await applyEconomyLoopMigration(String(req.body?.reportHash || ''), req.user!.userId) }) }
  catch (error: any) { return res.status(409).json({ success: false, message: error.message }) }
})

migrationRouter.get('/assignments', async (_req, res) => {
  try { return res.json({ success: true, data: await inspectAssignmentMigration() }) }
  catch (error: any) { return res.status(500).json({ success: false, message: error.message }) }
})

migrationRouter.post('/assignments', async (req, res) => {
  try {
    const data = await applyAssignmentMigration(String(req.body?.reportHash || ''))
    logger.audit('assignment_migration_applied', { action: 'migration', metadata: data })
    return res.json({ success: true, data })
  } catch (error: any) {
    return res.status(409).json({ success: false, code: 'ASSIGNMENT_MIGRATION_STALE_OR_INVALID', message: error.message })
  }
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

migrationRouter.get('/organization-join', async (_req, res) => {
  try {
    return res.json({ success: true, data: await inspectOrganizationJoinMigration() })
  } catch (error: any) {
    logger.error('organization_join_migration_check_error', { action: 'migration', metadata: { error: error.message } })
    return res.status(500).json({ success: false, message: error.message })
  }
})

migrationRouter.post('/organization-join', async (_req, res) => {
  try {
    const data = await applyOrganizationJoinMigration()
    logger.audit('organization_join_migration_applied', { action: 'migration', metadata: data })
    return res.json({ success: true, data })
  } catch (error: any) {
    logger.error('organization_join_migration_apply_error', { action: 'migration', metadata: { error: error.message } })
    return res.status(500).json({ success: false, message: error.message })
  }
})

migrationRouter.get('/school-name-keys', async (_req, res) => {
  try {
    return res.json({ success: true, data: await inspectSchoolNameKeyMigration() })
  } catch (error: any) {
    logger.error('school_name_key_migration_check_error', { action: 'migration', metadata: { error: error.message } })
    return res.status(500).json({ success: false, message: error.message })
  }
})

migrationRouter.post('/school-name-keys', async (_req, res) => {
  try {
    const data = await applySchoolNameKeyMigration()
    logger.audit('school_name_key_migration_applied', { action: 'migration', metadata: data })
    return res.json({ success: true, data })
  } catch (error: any) {
    logger.error('school_name_key_migration_apply_error', { action: 'migration', metadata: { error: error.message } })
    return res.status(409).json({ success: false, message: error.message })
  }
})

migrationRouter.get('/school-directory-status', async (_req, res) => {
  try {
    return res.json({ success: true, data: await inspectSchoolDirectoryStatusMigration() })
  } catch (error: any) {
    logger.error('school_directory_status_migration_check_error', { action: 'migration', metadata: { error: error.message } })
    return res.status(500).json({ success: false, message: error.message })
  }
})

migrationRouter.post('/school-directory-status', async (req, res) => {
  try {
    const data = await applySchoolDirectoryStatusMigration(String(req.body?.reportHash || ''), req.user!.userId)
    logger.audit('school_directory_status_migration_applied', { action: 'migration', metadata: data })
    return res.json({ success: true, data })
  } catch (error: any) {
    logger.error('school_directory_status_migration_apply_error', { action: 'migration', metadata: { error: error.message } })
    return res.status(409).json({ success: false, code: 'SCHOOL_DIRECTORY_MIGRATION_STALE_OR_INVALID', message: error.message })
  }
})

migrationRouter.get('/judge-program-protocols', async (_req, res) => {
  try { return res.json({ success: true, data: await inspectJudgeProgramProtocolMigration() }) }
  catch (error: any) { return res.status(500).json({ success: false, message: error.message }) }
})

migrationRouter.post('/judge-program-protocols', async (req, res) => {
  try {
    const data = await applyJudgeProgramProtocolMigration(String(req.body?.reportHash || ''))
    logger.audit('judge_program_protocol_migration_applied', { action: 'migration', metadata: data })
    return res.json({ success: true, data })
  } catch (error: any) {
    return res.status(409).json({ success: false, code: 'JUDGE_PROGRAM_PROTOCOL_MIGRATION_STALE_OR_INVALID', message: error.message })
  }
})

migrationRouter.get('/training-engine', async (_req, res) => {
  try { return res.json({ success: true, data: await inspectTrainingEngineMigration() }) }
  catch (error: any) { return res.status(500).json({ success: false, message: error.message }) }
})

migrationRouter.post('/training-engine', async (req, res) => {
  try {
    const data = await applyTrainingEngineMigration(String(req.body?.reportHash || ''))
    logger.audit('training_engine_migration_applied', { action: 'migration', metadata: data })
    return res.json({ success: true, data })
  } catch (error: any) {
    return res.status(409).json({ success: false, code: 'TRAINING_ENGINE_MIGRATION_STALE_OR_INVALID', message: error.message })
  }
})
