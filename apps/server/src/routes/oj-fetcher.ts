import { Router, Request, Response } from 'express'
import { authenticate, authorize } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import {
  fetchProblemWithMetrics,
  getAdapter,
  getSupportedPlatforms,
  isPlatformSupported,
  OjErrorCode,
  OjFetchError,
  OJ_ERROR_HTTP_STATUS,
} from '../oj-adapters'
import {
  createOjFetchJobs,
  deleteOjFetchJob,
  getOjPlatformConfig,
  listOjFetchJobs,
  OjFetcherAdminError,
  retryOjFetchJob,
  updateOjPlatformConfig,
} from '../modules/oj-fetcher/application/oj-fetcher-admin.service'
import {
  downloadManualProblemAsset,
  OjRemoteAssetError,
} from '../modules/oj-fetcher/application/oj-fetcher-remote-assets.service'

export {
  isPrivateRemoteHost,
  validateRemoteUrl,
  validateRemoteUrlAsync,
} from '../modules/oj-fetcher/application/oj-fetcher-remote-assets.service'

export const ojFetcherRouter = Router()
const adminOnly = [authenticate, authorize('super_admin' as const, 'platform_admin' as const)]
const superAdminOnly = [authenticate, authorize('super_admin' as const)]
const authenticatedUsers = [
  authenticate,
  authorize(
    'super_admin' as const, 'platform_admin' as const, 'school_principal' as const,
    'teacher' as const, 'student' as const,
  ),
]

function adminEndpoint(handler: (req: Request, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req, res) => {
    try { await handler(req, res) }
    catch (error) {
      if (error instanceof OjFetcherAdminError) {
        return res.status(error.statusCode).json({ success: false, message: error.message })
      }
      throw error
    }
  })
}

ojFetcherRouter.get('/platforms', (_req, res) => {
  res.json({ success: true, data: getSupportedPlatforms() })
})

ojFetcherRouter.get('/platforms/:platform/config', ...superAdminOnly, adminEndpoint(async (req, res) => {
  res.json({ success: true, data: await getOjPlatformConfig(req.params.platform) })
}))

ojFetcherRouter.put('/platforms/:platform/config', ...superAdminOnly, adminEndpoint(async (req, res) => {
  res.json({ success: true, data: await updateOjPlatformConfig(req.params.platform, req.body.cookies) })
}))

ojFetcherRouter.get('/jobs', ...adminOnly, adminEndpoint(async (req, res) => {
  res.json({ success: true, data: await listOjFetchJobs(req.query) })
}))

ojFetcherRouter.post('/jobs/batch', ...adminOnly, adminEndpoint(async (req, res) => {
  const result = await createOjFetchJobs(req.body.platform, req.body.problemIds)
  res.json({ success: true, data: result.data })
}))

ojFetcherRouter.post('/jobs/:id/retry', ...adminOnly, adminEndpoint(async (req, res) => {
  await retryOjFetchJob(req.params.id)
  res.json({ success: true, message: '任务已重置' })
}))

ojFetcherRouter.delete('/jobs/:id', ...adminOnly, adminEndpoint(async (req, res) => {
  await deleteOjFetchJob(req.params.id)
  res.json({ success: true, message: '任务已删除' })
}))

ojFetcherRouter.post('/download-attachment', ...authenticatedUsers, asyncHandler(async (req: Request, res: Response) => {
  const { problemId, url, filename } = req.body || {}
  if (![problemId, url, filename].every(value => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ success: false, message: '缺少必要参数' })
  }
  try {
    const data = await downloadManualProblemAsset((req as any).user, { problemId, url, filename })
    res.json({ success: true, data })
  } catch (error) {
    if (error instanceof OjRemoteAssetError || (error && typeof error === 'object' && 'statusCode' in error)) {
      const status = Number((error as any).statusCode) || 500
      return res.status(status).json({ success: false, message: (error as Error).message })
    }
    throw error
  }
}, '下载附件失败'))

// Keep the dynamic route last so it cannot capture /jobs or /download-attachment.
ojFetcherRouter.get('/:platform/:problemId', ...authenticatedUsers, asyncHandler(async (req, res) => {
  const { platform, problemId } = req.params
  if (!isPlatformSupported(platform as any)) {
    return res.status(400).json({
      success: false,
      error: { code: OjErrorCode.PLATFORM_NOT_SUPPORTED, message: `不支持的 OJ 平台: ${platform}` },
    })
  }
  const adapter = getAdapter(platform as any)
  if (!adapter.isValidProblemId(problemId)) {
    return res.status(400).json({
      success: false,
      error: { code: OjErrorCode.INVALID_PROBLEM_ID, message: `无效的${adapter.name}题号格式: ${problemId}` },
    })
  }
  try {
    const problem = await fetchProblemWithMetrics(platform as any, problemId)
    res.json({ success: true, data: problem })
  } catch (error) {
    if (error instanceof OjFetchError) {
      return res.status(OJ_ERROR_HTTP_STATUS[error.code] || 500).json({
        success: false, error: { code: error.code, message: error.message },
      })
    }
    throw error
  }
}, '拉取题目失败'))
