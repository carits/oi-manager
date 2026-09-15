import { Router, type Response } from 'express'
import { OrganizationContracts } from '@oi-manager/contracts'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'
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
      if (sendContractError(cause, res)) return
      if (cause instanceof OrganizationJoinError) return res.status(cause.statusCode).json({ success: false, code: cause.code, message: cause.message })
      throw cause
    }
  }, '组织加入操作失败')
}

organizationJoinRouter.get('/organizations', authenticate, endpoint(async (req, res) => {
  const query = parseContractQuery(OrganizationContracts.directory, req.query)
  sendContractData(res, OrganizationContracts.directory, await listOrganizationDirectory(actor(req), query))
}))
organizationJoinRouter.get('/me/organizations', authenticate, endpoint(async (req, res) => {
  sendContractData(res, OrganizationContracts.mine, await listMyOrganizations(actor(req)))
}))
organizationJoinRouter.get('/me/organization-join-applications', authenticate, endpoint(async (req, res) => {
  const data = await listMyOrganizations(actor(req)); res.json({ success: true, data: data.applications })
}))
organizationJoinRouter.post('/organization-join-applications', authenticate, endpoint(async (req, res) => {
  sendContractData(res, OrganizationContracts.createJoinApplication, await createJoinApplication(actor(req), parseContractBody(OrganizationContracts.createJoinApplication, req.body)), 201)
}))
organizationJoinRouter.post('/organization-join-applications/:id/cancel', authenticate, endpoint(async (req, res) => {
  parseContractBody(OrganizationContracts.cancelJoinApplication, req.body || {})
  await cancelJoinApplication(actor(req), req.params.id)
  sendContractData(res, OrganizationContracts.cancelJoinApplication, { cancelled: true })
}))

organizationJoinRouter.get('/organizations/:organizationId/join-applications', authenticate, endpoint(async (req, res) => {
  res.json({ success: true, data: await listJoinApplications(actor(req), req.params.organizationId, req.query) })
}))
organizationJoinRouter.get('/organizations/:organizationId/join-applications/:id', authenticate, endpoint(async (req, res) => {
  res.json({ success: true, data: await getJoinApplication(actor(req), req.params.organizationId, req.params.id) })
}))
organizationJoinRouter.post('/organizations/:organizationId/join-applications/:id/approve', authenticate, endpoint(async (req, res) => {
  res.json({ success: true, data: await decideJoinApplication(actor(req), req.params.organizationId, req.params.id, 'approve', req.body || {}) })
}))
organizationJoinRouter.post('/organizations/:organizationId/join-applications/:id/reject', authenticate, endpoint(async (req, res) => {
  res.json({ success: true, data: await decideJoinApplication(actor(req), req.params.organizationId, req.params.id, 'reject', req.body || {}) })
}))

organizationJoinRouter.get('/organizations/:organizationId/invitations', authenticate, endpoint(async (req, res) => {
  res.json({ success: true, data: await listOrganizationInvitations(actor(req), req.params.organizationId, req.query) })
}))
organizationJoinRouter.post('/organizations/:organizationId/invitations', authenticate, endpoint(async (req, res) => {
  res.status(201).json({ success: true, data: await createOrganizationInvitation(actor(req), req.params.organizationId, req.body || {}) })
}))
organizationJoinRouter.post('/organizations/:organizationId/invitations/:id/revoke', authenticate, endpoint(async (req, res) => {
  await revokeOrganizationInvitation(actor(req), req.params.organizationId, req.params.id); res.json({ success: true })
}))
organizationJoinRouter.post('/organization-invitations/:id/accept', authenticate, endpoint(async (req, res) => {
  parseContractBody(OrganizationContracts.respondInvitation, req.body || {})
  sendContractData(res, OrganizationContracts.respondInvitation, await respondToInvitation(actor(req), req.params.id, 'accept'))
}))
organizationJoinRouter.post('/organization-invitations/:id/decline', authenticate, endpoint(async (req, res) => {
  parseContractBody(OrganizationContracts.respondInvitation, req.body || {})
  sendContractData(res, OrganizationContracts.respondInvitation, await respondToInvitation(actor(req), req.params.id, 'decline'))
}))
organizationJoinRouter.patch('/organizations/:organizationId/join-policy', authenticate, endpoint(async (req, res) => {
  res.json({ success: true, data: await updateJoinPolicy(actor(req), req.params.organizationId, req.body?.joinPolicy) })
}))
