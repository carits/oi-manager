import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { hasOrganizationContext, isPlatformAdministrator, plannedFeatureResponse } from '../featureAvailability'

export const caritsRouter = Router()

function requireOrganization(req: any, res: any) {
  const organizationId = String(req.params.organizationId || '')
  if (!hasOrganizationContext(req.user, organizationId)) {
    res.status(403).json({ success: false, message: '无权访问该校园的 Carits币信息' })
    return false
  }
  return true
}

caritsRouter.get('/me', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: plannedFeatureResponse('carits', 'personal') })
}))

caritsRouter.get('/me/transactions', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: plannedFeatureResponse('carits', 'personal') })
}))

caritsRouter.get('/organizations/:organizationId', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  res.json({ success: true, data: plannedFeatureResponse('carits', 'organization') })
}))

caritsRouter.get('/organizations/:organizationId/transactions', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  res.json({ success: true, data: plannedFeatureResponse('carits', 'organization') })
}))

caritsRouter.get('/platform', asyncHandler(async (req, res) => {
  if (!isPlatformAdministrator(req.user)) {
    return res.status(403).json({ success: false, message: '仅平台管理员可查看 Carits币审计入口' })
  }
  res.json({ success: true, data: plannedFeatureResponse('carits', 'platform') })
}))
