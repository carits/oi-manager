import { Router } from 'express'
import {
  authenticate,
  getMembershipType,
  getResourceScope,
  requireOrganizationContext,
  requirePersonalContext,
} from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import {
  DashboardActor,
  getMyPersonalOverview,
  listMyContests,
  listMyHomeworks,
} from '../modules/dashboard/application/dashboard.service'

export const meRouter = Router()

function actor(user: NonNullable<Express.Request['user']>): DashboardActor {
  return {
    userId: user.userId,
    membershipType: getMembershipType(user),
    resourceScope: getResourceScope(user),
    organizationId: user.organizationId,
  }
}

meRouter.get('/homeworks', authenticate, requireOrganizationContext, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listMyHomeworks(actor(req.user!)) })
}))

meRouter.get('/contests', authenticate, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await listMyContests(actor(req.user!)) })
}))

meRouter.get('/overview', authenticate, requirePersonalContext, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getMyPersonalOverview(actor(req.user!)) })
}))
