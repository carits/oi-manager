import { Router, Request, Response } from 'express'
import { OjFetcherContracts } from '@oi-manager/contracts'
import { authenticate, authorize } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../lib/api-contract'
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
const authenticatedUsers = [authenticate]

function adminEndpoint(handler: (req: Request, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req, res) => {
    try { await handler(req, res) }
    catch (error) {
      if (sendContractError(error, res)) return
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
  return sendContractData(res, OjFetcherContracts.getPlatformConfig, await getOjPlatformConfig(req.params.platform))
}))

ojFetcherRouter.put('/platforms/:platform/config', ...superAdminOnly, adminEndpoint(async (req, res) => {
  const body = parseContractBody(OjFetcherContracts.updatePlatformConfig, req.body)
  return sendContractData(
    res,
    OjFetcherContracts.updatePlatformConfig,
    await updateOjPlatformConfig(req.params.platform, body.cookies),
  )
}))

ojFetcherRouter.get('/jobs', ...adminOnly, adminEndpoint(async (req, res) => {
  const query = parseContractQuery(OjFetcherContracts.listJobs, req.query)
  return sendContractData(res, OjFetcherContracts.listJobs, await listOjFetchJobs(query))
}))

ojFetcherRouter.post('/jobs/batch', ...adminOnly, adminEndpoint(async (req, res) => {
  const body = parseContractBody(OjFetcherContracts.createBatch, req.body)
  const result = await createOjFetchJobs(body.platform, body.problemIds)
  return sendContractData(res, OjFetcherContracts.createBatch, result.data)
}))

ojFetcherRouter.post('/jobs/:id/retry', ...adminOnly, adminEndpoint(async (req, res) => {
  parseContractBody(OjFetcherContracts.retryJob, req.body || {})
  await retryOjFetchJob(req.params.id)
  return sendContractData(res, OjFetcherContracts.retryJob, {})
}))

ojFetcherRouter.delete('/jobs/:id', ...adminOnly, adminEndpoint(async (req, res) => {
  parseContractBody(OjFetcherContracts.deleteJob, req.body || {})
  await deleteOjFetchJob(req.params.id)
  return sendContractData(res, OjFetcherContracts.deleteJob, {})
}))

ojFetcherRouter.post('/download-attachment', ...authenticatedUsers, asyncHandler(async (req: Request, res: Response) => {
  try {
    const body = parseContractBody(OjFetcherContracts.downloadAttachment, req.body)
    const data = await downloadManualProblemAsset((req as any).user, body)
    sendContractData(res, OjFetcherContracts.downloadAttachment, data)
  } catch (error) {
    if (sendContractError(error, res)) return
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
    sendContractData(res, OjFetcherContracts.fetchProblem, problem)
  } catch (error) {
    if (error instanceof OjFetchError) {
      return res.status(OJ_ERROR_HTTP_STATUS[error.code] || 500).json({
        success: false, error: { code: error.code, message: error.message },
      })
    }
    throw error
  }
}, '拉取题目失败'))
