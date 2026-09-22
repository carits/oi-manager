import compression from 'compression'
import cors from 'cors'
import express from 'express'
import { sendContractError } from './lib/api-contract'
import helmet from 'helmet'
import { MulterError } from 'multer'
import path from 'path'
import { adminDataRouter } from './routes/admin-data'
import { authRouter } from './routes/auth'
import { demoScenarioRouter } from './routes/demo-scenario'
import { filesRouter } from './routes/files'
import { meRouter } from './routes/me'
import { ojAccountsRouter } from './routes/oj-accounts'
import { ojFetcherRouter } from './routes/oj-fetcher'
import { organizationMemberRouter } from './routes/organization-members'
import { platformOrganizationRouter } from './routes/platform-organizations'
import { problemListsRouter } from './routes/problem-lists'
import { statsRouter } from './routes/stats'
import { submitRouter } from './routes/submit'
import { submissionsRouter } from './routes/submissions'
import { teamProblemListsRouter } from './routes/team-problem-lists'
import { teamRouter } from './routes/teams'
import { telemetryRouter } from './modules/telemetry/telemetry.routes'
import { testdataRouter } from './routes/testdata'
import { userRouter } from './routes/users'
import { workspaceRouter } from './routes/workspaces'
import { aiTokenAdminRouter } from './modules/ai/ai-token.routes'
import { assignmentRouter } from './modules/assignment/assignment.routes'
import { blogRouter } from './modules/blog/blog.routes'
import { caritsRouter } from './modules/carits/carits.routes'
import { resourceRouter } from './modules/carits/resource.routes'
import { chatReportAdminRouter, chatRouter, chatStickerAdminRouter } from './modules/chat/chat.routes'
import { contributionRouter, platformContributionRouter } from './modules/contribution/contribution.routes'
import { dataMarketRouter } from './modules/data-market/data-market.routes'
import { notificationRouter } from './modules/notification/notification.routes'
import { organizationCreationRouter } from './modules/organization-creation/organization-creation.routes'
import { organizationJoinRouter } from './modules/organization-join/organization-join.routes'
import { problemsRouter } from './modules/problem/problem.routes'
import { problemSelectionRouter } from './modules/problem-selection/problem-selection.routes'
import { platformBindingRouter } from './modules/platform-binding/platform-binding.routes'
import { judgeProgramTemplateRouter } from './modules/problem/problem.judge-program.routes'
import { rankingRouter } from './modules/ranking/ranking.routes'
import { ratingDomainRouter } from './modules/rating/rating-domain.routes'
import { solutionContributionRouter, solutionReviewRouter, solutionRouter } from './modules/solution/solution.routes'
import { healthRouter } from './modules/system/health.routes'
import { trainingEngineRouter } from './modules/training-engine/training-engine.routes'
import { retiredTrainingRouter } from './modules/training/training-legacy-retired.routes'
import { teamImportRouter } from './modules/team-import/team-import.routes'
import { getCorsOptions } from './config/cors'
import { isProduction } from './config/env'
import { STORAGE_ROOT } from './config/storage'
import { authenticate } from './middleware/auth'
import { verifyCookieOrigin } from './middleware/csrf'
import { globalLimiter } from './middleware/rateLimiter'
import { requestLogger } from './middleware/requestLogger'
import { isInvalidJsonBodyError } from './lib/httpErrors'
import logger from './lib/logger'

export interface ApplicationOptions {
  disableRateLimit?: boolean
  allowAnyCorsOrigin?: boolean
}

/**
 * Build the complete HTTP application without opening sockets or registering
 * process handlers. Production and integration tests must both use this
 * composition root so their middleware and route ordering cannot drift.
 */
export function createApplication(options: ApplicationOptions = {}) {
  const app = express()

  app.set('trust proxy', 'loopback')
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }))
  app.use(cors(options.allowAnyCorsOrigin
    ? { origin: true, credentials: true }
    : getCorsOptions()))
  app.use(compression())
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))
  app.use(requestLogger)
  app.use(verifyCookieOrigin)
  if (!options.disableRateLimit) app.use('/api', globalLimiter)

  app.use('/uploads/public', express.static(path.join(STORAGE_ROOT, 'public')))
  app.use('/public', express.static(path.join(STORAGE_ROOT, 'public')))

  // Public probes must remain ahead of feature routers mounted at /api.
  app.use('/api', healthRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/organizations/:organizationId/members', authenticate, organizationMemberRouter)
  app.use('/api/platform/organizations', platformOrganizationRouter)
  app.use('/api/teams', teamRouter)
  app.use('/api/users', authenticate, userRouter)
  app.use('/api/stats', authenticate, statsRouter)
  app.use('/api/problems', problemsRouter)
  app.use('/api', problemSelectionRouter)
  app.use('/api', judgeProgramTemplateRouter)
  app.use('/api/oj-fetcher', authenticate, ojFetcherRouter)
  app.use('/api/files', filesRouter)
  app.use('/api/platform-bindings', platformBindingRouter)
  app.use('/api/team-import', authenticate, teamImportRouter)
  app.use('/api/submissions', submissionsRouter)
  app.use('/api/problem-lists', problemListsRouter)
  app.use('/api/teams', teamProblemListsRouter)
  app.use('/api/oj-accounts', authenticate, ojAccountsRouter)
  app.use('/api/submit', submitRouter)
  app.use('/api', testdataRouter)
  app.use('/api', retiredTrainingRouter)
  app.use('/api', trainingEngineRouter)
  app.use('/api', assignmentRouter)
  app.use('/api/admin/data', authenticate, adminDataRouter)
  app.use('/api/rankings', rankingRouter)
  app.use('/api', ratingDomainRouter)
  app.use('/api/me', meRouter)
  app.use('/api/notifications', authenticate, notificationRouter)
  app.use('/api', organizationJoinRouter)
  app.use('/api', organizationCreationRouter)
  app.use('/api/carits', authenticate, caritsRouter)
  app.use('/api/platform-admin/ai', authenticate, aiTokenAdminRouter)
  app.use('/api/contributions', authenticate, contributionRouter)
  app.use('/api/platform/contributions', authenticate, platformContributionRouter)
  app.use('/api/solution-contributions', solutionContributionRouter)
  app.use('/api/solutions', solutionRouter)
  app.use('/api/review/solution-contributions', solutionReviewRouter)
  app.use('/api', dataMarketRouter)
  app.use('/api', blogRouter)
  app.use('/api/resources', authenticate, resourceRouter)
  app.use('/api/telemetry', telemetryRouter)
  app.use('/api/workspaces', workspaceRouter)
  app.use('/api/chat', chatRouter)
  app.use('/api/platform/chat-reports', chatReportAdminRouter)
  app.use('/api/platform', chatStickerAdminRouter)
  app.use('/api/admin/demo-scenario', demoScenarioRouter)

  app.use((req, res) => {
    res.status(404).json({ success: false, message: '接口不存在' })
  })

  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (sendContractError(err, res)) return
    if (isInvalidJsonBodyError(err)) {
      logger.warn('invalid_json_body', {
        requestId: req.requestId,
        action: 'request_rejected',
        metadata: { path: req.path, method: req.method },
      })
      return res.status(400).json({ success: false, message: '请求 JSON 格式无效' })
    }

    if (err instanceof MulterError) {
      let message = '文件上传失败'
      if (err.code === 'LIMIT_FILE_SIZE') message = '文件大小超出限制'
      else if (err.code === 'LIMIT_FILE_COUNT') message = '文件数量超出限制'
      else if (err.code === 'LIMIT_UNEXPECTED_FILE') message = '意外的文件字段'
      logger.warn('upload_error', {
        requestId: req.requestId,
        action: 'upload_error',
        metadata: { code: err.code, message: err.message },
      })
      return res.status(400).json({ success: false, message })
    }

    if (err.message === '只支持图片文件' || err.message === '不支持的文件类型') {
      logger.warn('upload_type_error', {
        requestId: req.requestId,
        action: 'upload_type_error',
        metadata: { message: err.message },
      })
      return res.status(400).json({ success: false, message: err.message })
    }

    if (err.message === 'Not allowed by CORS') {
      logger.security('cors_blocked', {
        requestId: req.requestId,
        action: 'cors_blocked',
        metadata: { origin: req.headers.origin },
      })
      return res.status(403).json({ success: false, message: '不允许的跨域请求' })
    }

    logger.error('unhandled_error', err, {
      requestId: req.requestId,
      userId: req.user?.userId,
      accountRole: req.user?.accountRole,
      organizationRole: req.user?.organizationRole,
      organizationId: req.user?.organizationId,
      action: 'unhandled_error',
      metadata: { path: req.path, method: req.method },
    })
    res.status(500).json({
      success: false,
      message: isProduction() ? '服务器错误' : err.message || '服务器错误',
    })
  })

  return app
}
