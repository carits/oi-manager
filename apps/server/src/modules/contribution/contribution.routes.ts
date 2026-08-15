import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { hasOrganizationContext, isPlatformAdministrator, plannedFeatureResponse } from '../featureAvailability'

export const contributionRouter = Router()

function requireOrganization(req: any, res: any) {
  const organizationId = String(req.params.organizationId || '')
  if (!hasOrganizationContext(req.user, organizationId)) {
    res.status(403).json({ success: false, message: '无权访问该校园的贡献信息' })
    return false
  }
  return true
}

contributionRouter.get('/me/summary', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: plannedFeatureResponse('contributions', 'personal') })
}))

contributionRouter.get('/me/events', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: plannedFeatureResponse('contributions', 'personal') })
}))

contributionRouter.get('/rankings/users', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: plannedFeatureResponse('contributions', 'personal') })
}))

contributionRouter.get('/rankings/organizations', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: plannedFeatureResponse('contributions', 'organization') })
}))

contributionRouter.get('/organizations/:organizationId', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  res.json({ success: true, data: plannedFeatureResponse('contributions', 'organization') })
}))

contributionRouter.get('/organizations/:organizationId/events', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  res.json({ success: true, data: plannedFeatureResponse('contributions', 'organization') })
}))

contributionRouter.get('/platform', asyncHandler(async (req, res) => {
  if (!isPlatformAdministrator(req.user)) {
    return res.status(403).json({ success: false, message: '仅平台管理员可查看贡献审计入口' })
  }
  res.json({ success: true, data: plannedFeatureResponse('contributions', 'platform') })
}))
