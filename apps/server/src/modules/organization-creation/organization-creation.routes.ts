import { Router, type Response } from 'express'
import { OrganizationContracts } from '@oi-manager/contracts'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'
import { IdempotencyConflictError, readIdempotencyKey, requestFingerprint, runIdempotent } from '../../lib/idempotency'
import { authenticate, type AuthRequest } from '../../middleware/auth'
import {
  cancelOrganizationApplication,
  createOrganizationApplication,
  decideOrganizationApplication,
  getMyOrganizationApplication,
  getOrganizationApplication,
  listMyOrganizationApplications,
  listOrganizationApplications,
  OrganizationCreationError,
} from './organization-creation.service'

export const organizationCreationRouter = Router()

const actor = (req: AuthRequest) => ({ userId: req.user!.userId, role: req.user!.role })

function endpoint(handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (sendContractError(error, res)) return
      if (error instanceof OrganizationCreationError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
      if (error instanceof IdempotencyConflictError) return res.status(409).json({ success: false, code: 'IDEMPOTENCY_KEY_REUSED', message: error.message })
      throw error
    }
  }, '组织创建申请操作失败')
}

async function mutation<T>(req: AuthRequest, scope: string, operation: () => Promise<T>) {
  return runIdempotent(`${scope}:${req.user!.userId}`, readIdempotencyKey(req), requestFingerprint({ params: req.params, body: req.body || {} }), operation)
}

organizationCreationRouter.post('/organization-creation-applications', authenticate, endpoint(async (req, res) => {
  const body = parseContractBody(OrganizationContracts.createOrganizationApplication, req.body)
  const result = await mutation(req, 'organization-creation:submit', () => createOrganizationApplication(actor(req), body))
  if (result.replayed) res.setHeader('X-Idempotent-Replay', 'true')
  sendContractData(res, OrganizationContracts.createOrganizationApplication, result.value, 201)
}))
organizationCreationRouter.get('/me/organization-creation-applications', authenticate, endpoint(async (req, res) => {
  const query = parseContractQuery(OrganizationContracts.listMyCreationApplications, req.query)
  sendContractData(res, OrganizationContracts.listMyCreationApplications, await listMyOrganizationApplications(actor(req), query))
}))
organizationCreationRouter.get('/me/organization-creation-applications/:id', authenticate, endpoint(async (req, res) => {
  res.json({ success: true, data: await getMyOrganizationApplication(actor(req), req.params.id) })
}))
organizationCreationRouter.post('/organization-creation-applications/:id/cancel', authenticate, endpoint(async (req, res) => {
  parseContractBody(OrganizationContracts.cancelOrganizationApplication, req.body || {})
  const result = await mutation(req, 'organization-creation:cancel', () => cancelOrganizationApplication(actor(req), req.params.id))
  if (result.replayed) res.setHeader('X-Idempotent-Replay', 'true')
  sendContractData(res, OrganizationContracts.cancelOrganizationApplication, result.value)
}))

organizationCreationRouter.get('/platform/organization-creation-applications', authenticate, endpoint(async (req, res) => {
  res.json({ success: true, data: await listOrganizationApplications(actor(req), req.query) })
}))
organizationCreationRouter.get('/platform/organization-creation-applications/:id', authenticate, endpoint(async (req, res) => {
  res.json({ success: true, data: await getOrganizationApplication(actor(req), req.params.id) })
}))
organizationCreationRouter.post('/platform/organization-creation-applications/:id/approve', authenticate, endpoint(async (req, res) => {
  const result = await mutation(req, 'organization-creation:approve', () => decideOrganizationApplication(actor(req), req.params.id, 'approve', req.body || {}))
  if (result.replayed) res.setHeader('X-Idempotent-Replay', 'true')
  res.json({ success: true, data: result.value })
}))
organizationCreationRouter.post('/platform/organization-creation-applications/:id/reject', authenticate, endpoint(async (req, res) => {
  const result = await mutation(req, 'organization-creation:reject', () => decideOrganizationApplication(actor(req), req.params.id, 'reject', req.body || {}))
  if (result.replayed) res.setHeader('X-Idempotent-Replay', 'true')
  res.json({ success: true, data: result.value })
}))
