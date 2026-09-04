import { Router, type Response } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { authenticate, type AuthRequest } from '../../middleware/auth'
import {
  cancelJoinApplication,
  createJoinApplication,
  createOrganizationInvitation,
  decideJoinApplication,
  getJoinApplication,
  JoinActor,
  listJoinApplications,
  listMyOrganizations,
  listOrganizationDirectory,
  listOrganizationInvitations,
  OrganizationJoinError,
  respondToInvitation,
  revokeOrganizationInvitation,
  updateJoinPolicy,
} from './organization-join.service'

export const organizationJoinRouter = Router()

function actor(req: AuthRequest): JoinActor {
  return {
    userId: req.user!.userId, role: req.user!.role, organizationId: req.user!.organizationId,
    organizationMembershipId: req.user!.organizationMembershipId,
  }
}

function endpoint(handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try { await handler(req, res) }
    catch (cause) {
      if (cause instanceof OrganizationJoinError) return res.status(cause.statusCode).json({ success: false, code: cause.code, message: cause.message })
      throw cause
    }
  }, '组织加入操作失败')
}

organizationJoinRouter.use(authenticate)

organizationJoinRouter.get('/organizations', endpoint(async (req, res) => {
  res.json({ success: true, data: await listOrganizationDirectory(actor(req), req.query) })
}))
organizationJoinRouter.get('/me/organizations', endpoint(async (req, res) => {
  res.json({ success: true, data: await listMyOrganizations(actor(req)) })
}))
organizationJoinRouter.get('/me/organization-join-applications', endpoint(async (req, res) => {
  const data = await listMyOrganizations(actor(req)); res.json({ success: true, data: data.applications })
}))
organizationJoinRouter.post('/organization-join-applications', endpoint(async (req, res) => {
  res.status(201).json({ success: true, data: await createJoinApplication(actor(req), req.body || {}) })
}))
organizationJoinRouter.post('/organization-join-applications/:id/cancel', endpoint(async (req, res) => {
  await cancelJoinApplication(actor(req), req.params.id); res.json({ success: true })
}))

organizationJoinRouter.get('/organizations/:organizationId/join-applications', endpoint(async (req, res) => {
  res.json({ success: true, data: await listJoinApplications(actor(req), req.params.organizationId, req.query) })
}))
organizationJoinRouter.get('/organizations/:organizationId/join-applications/:id', endpoint(async (req, res) => {
  res.json({ success: true, data: await getJoinApplication(actor(req), req.params.organizationId, req.params.id) })
}))
organizationJoinRouter.post('/organizations/:organizationId/join-applications/:id/approve', endpoint(async (req, res) => {
  res.json({ success: true, data: await decideJoinApplication(actor(req), req.params.organizationId, req.params.id, 'approve', req.body || {}) })
}))
organizationJoinRouter.post('/organizations/:organizationId/join-applications/:id/reject', endpoint(async (req, res) => {
  res.json({ success: true, data: await decideJoinApplication(actor(req), req.params.organizationId, req.params.id, 'reject', req.body || {}) })
}))

organizationJoinRouter.get('/organizations/:organizationId/invitations', endpoint(async (req, res) => {
  res.json({ success: true, data: await listOrganizationInvitations(actor(req), req.params.organizationId, req.query) })
}))
organizationJoinRouter.post('/organizations/:organizationId/invitations', endpoint(async (req, res) => {
  res.status(201).json({ success: true, data: await createOrganizationInvitation(actor(req), req.params.organizationId, req.body || {}) })
}))
organizationJoinRouter.post('/organizations/:organizationId/invitations/:id/revoke', endpoint(async (req, res) => {
  await revokeOrganizationInvitation(actor(req), req.params.organizationId, req.params.id); res.json({ success: true })
}))
organizationJoinRouter.post('/organization-invitations/:id/accept', endpoint(async (req, res) => {
  res.json({ success: true, data: await respondToInvitation(actor(req), req.params.id, 'accept') })
}))
organizationJoinRouter.post('/organization-invitations/:id/decline', endpoint(async (req, res) => {
  res.json({ success: true, data: await respondToInvitation(actor(req), req.params.id, 'decline') })
}))
organizationJoinRouter.patch('/organizations/:organizationId/join-policy', endpoint(async (req, res) => {
  res.json({ success: true, data: await updateJoinPolicy(actor(req), req.params.organizationId, req.body?.joinPolicy) })
}))
