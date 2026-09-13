/** 评测记录 HTTP API。授权与持久化由 application service 负责。 */
import { Router } from 'express'
import { authenticate, getAccountRole, getResourceScope, isAdmin, isPersonalContext } from '../middleware/auth'
import { logger } from '../lib/logger'
import {
  getSubmissionDetail,
  listSubmissions,
  refetchSubmissionCode,
  SubmissionQueryError,
  type SubmissionQueryContext,
} from '../modules/submission/application/submission-query.service'
import { createSubmissionBlogSnapshot } from '../modules/submission/application/submission-blog-snapshot.service'

export const submissionsRouter = Router()

function contextOf(req: any): SubmissionQueryContext {
  const user = req.user
  return {
    userId: user.userId,
    organizationRole: user.organizationRole || null,
    workspaceScope: getResourceScope(user),
    organizationId: user.organizationId || null,
    isGlobalAdmin: isAdmin(getAccountRole(user)!),
    isPersonal: isPersonalContext(user),
  }
}

function sendError(res: any, error: unknown, action: string, fallback: string) {
  if (error instanceof SubmissionQueryError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
  }
  logger.error(action, { action: 'submissions', metadata: { error: (error as Error).message } })
  return res.status(500).json({ success: false, message: fallback })
}

submissionsRouter.get('/', authenticate, async (req, res) => {
  try {
    const data = await listSubmissions(contextOf(req), req.query as Record<string, string>)
    return res.json({ success: true, data })
  } catch (error) {
    return sendError(res, error, 'submissions_list_error', '查询失败')
  }
})

submissionsRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const data = await getSubmissionDetail(contextOf(req), Number(req.params.id))
    return res.json({ success: true, data })
  } catch (error) {
    return sendError(res, error, 'submission_detail_error', '查询失败')
  }
})

submissionsRouter.post('/:id/refetch-code', authenticate, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ success: false, code: 'INVALID_SUBMISSION_ID', message: '无效的提交 ID' })
    }
    const data = await refetchSubmissionCode(contextOf(req), Number(req.params.id))
    return res.json({ success: true, data })
  } catch (error) {
    return sendError(res, error, 'submission_refetch_code_error', '抓取失败')
  }
})

submissionsRouter.post('/:id/blog-snapshots', authenticate, async (req, res) => {
  try {
    if (!/^\d+$/.test(req.params.id)) throw new SubmissionQueryError(422, 'INVALID_SUBMISSION_ID', '无效的提交 ID')
    const data = await createSubmissionBlogSnapshot(req.user!.userId, Number(req.params.id), req.body)
    return res.status(201).json({ success: true, data })
  } catch (error) {
    return sendError(res, error, 'submission_blog_snapshot_create_failed', '创建提交快照失败')
  }
})
