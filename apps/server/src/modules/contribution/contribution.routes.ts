import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { hasOrganizationContext, isPlatformAdministrator } from '../featureAvailability'
import {
  getContributionSummary,
  listContributionRanking,
  listMyContributionEvents,
  listOrganizationContributionEvents,
  listPlatformContributionEvents,
} from './application/contribution.service'

export const contributionRouter = Router()

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
  res.json({ success: true, data: await listMyContributionEvents(req.user!.userId) })
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
  res.json({ success: true, data: await listPlatformContributionEvents() })
}))
