import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { parsePagination } from '../../lib/pagination'
import { hasOrganizationContext, isPlatformAdministrator } from '../featureAvailability'
import {
  getContributionSummary,
  listContributionRanking,
  listMyContributionEvents,
  listOrganizationContributionEvents,
  listPlatformContributionEvents,
} from './application/contribution.service'
import { acceptContribution, ContributionRewardError, getContributionEvidence, listContributionAudit, rejectContribution, retryContributionReward, revokeContribution } from './application/contribution-reward.service'

export const contributionRouter = Router()
export const platformContributionRouter = Router()

function requireOrganization(req: any, res: any) {
  const organizationId = String(req.params.organizationId || '')
  if (!hasOrganizationContext(req.user, organizationId)) {
    res.status(403).json({ success: false, message: '无权访问该校园的贡献排名' })
    return false
  }
  return true
}

contributionRouter.get('/me/summary', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getContributionSummary(req.user!.userId) })
}))

contributionRouter.get('/me/events', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listMyContributionEvents(
    req.user!.userId,
    parsePagination(req.query, { defaultPageSize: 20, maxPageSize: 100 }),
  ) })
}))

contributionRouter.get('/rankings/users', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await listContributionRanking() })
}))

contributionRouter.get('/organizations/:organizationId/rankings', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  res.json({ success: true, data: await listContributionRanking(req.params.organizationId) })
}))

contributionRouter.get('/organizations/:organizationId/events', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  res.json({ success: true, data: await listOrganizationContributionEvents(req.params.organizationId) })
}))

contributionRouter.get('/platform', asyncHandler(async (req, res) => {
  if (!isPlatformAdministrator(req.user)) {
    return res.status(403).json({ success: false, message: '仅平台管理员可查看贡献审计入口' })
  }
  res.json({ success: true, data: await listContributionAudit(
    String(req.query.status || ''),
    parsePagination(req.query, { defaultPageSize: 20, maxPageSize: 100 }),
  ) })
}))

function requireSuperAdmin(req: any, res: any) {
  if (req.user?.role !== 'super_admin') { res.status(403).json({ success: false, code: 'SUPER_ADMIN_REQUIRED', message: '只有超级管理员可以处理经济贡献事件' }); return false }
  return true
}
function decision(handler: (req: any) => Promise<unknown>) {
  return asyncHandler(async (req: any, res: any) => {
    if (!requireSuperAdmin(req, res)) return
    try { res.json({ success: true, data: await handler(req) }) }
    catch (error) {
      if (error instanceof ContributionRewardError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
      throw error
    }
  })
}
platformContributionRouter.get('/', asyncHandler(async (req, res) => {
  if (!isPlatformAdministrator(req.user)) return res.status(403).json({ success: false, message: '仅平台管理员可查看贡献审计入口' })
  res.json({ success: true, data: await listContributionAudit(
    String(req.query.status || ''),
    parsePagination(req.query, { defaultPageSize: 20, maxPageSize: 100 }),
  ) })
}))
platformContributionRouter.get('/:id/evidence', asyncHandler(async (req, res) => {
  if (!isPlatformAdministrator(req.user)) return res.status(403).json({ success: false, message: '仅平台管理员可查看贡献审计证据' })
  try { res.json({ success: true, data: await getContributionEvidence(req.params.id, String(req.query.kind || '')) }) }
  catch (error) {
    if (error instanceof ContributionRewardError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
    throw error
  }
}))
platformContributionRouter.post('/:id/accept', decision(req => acceptContribution(req.user.userId, req.params.id)))
platformContributionRouter.post('/:id/reject', decision(req => rejectContribution(req.user.userId, req.params.id, String(req.body?.reason || ''))))
platformContributionRouter.post('/:id/revoke', decision(req => revokeContribution(req.user.userId, req.params.id, String(req.body?.reason || ''))))
platformContributionRouter.post('/:id/retry-reward', decision(req => retryContributionReward(req.user.userId, req.params.id)))
