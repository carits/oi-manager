import { Router } from 'express'
import { ContributionContracts } from '@oi-manager/contracts'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, parseContractQuery, sendContractData } from '../../lib/api-contract'
import { getAccountRole } from '../../middleware/auth'
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
  sendContractData(res, ContributionContracts.summary, await getContributionSummary(req.user!.userId))
}))

contributionRouter.get('/me/events', asyncHandler(async (req, res) => {
  const query = parseContractQuery(ContributionContracts.mine, req.query)
  sendContractData(res, ContributionContracts.mine, await listMyContributionEvents(req.user!.userId, {
    ...query, skip: (query.page - 1) * query.pageSize,
  }))
}))

contributionRouter.get('/rankings/users', asyncHandler(async (req, res) => {
  parseContractQuery(ContributionContracts.userRanking, req.query)
  sendContractData(res, ContributionContracts.userRanking, await listContributionRanking())
}))

contributionRouter.get('/organizations/:organizationId/rankings', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  parseContractQuery(ContributionContracts.organizationRanking, req.query)
  sendContractData(res, ContributionContracts.organizationRanking, await listContributionRanking(req.params.organizationId))
}))

contributionRouter.get('/organizations/:organizationId/events', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  sendContractData(res, ContributionContracts.organizationEvents, await listOrganizationContributionEvents(req.params.organizationId))
}))

contributionRouter.get('/platform', asyncHandler(async (req, res) => {
  if (!isPlatformAdministrator(req.user)) {
    return res.status(403).json({ success: false, message: '仅平台管理员可查看贡献审计入口' })
  }
  const query = parseContractQuery(ContributionContracts.audit, req.query)
  sendContractData(res, ContributionContracts.audit, await listContributionAudit(query.status, { ...query, skip: (query.page - 1) * query.pageSize }))
}))

function requireSuperAdmin(req: any, res: any) {
  if (getAccountRole(req.user) !== 'super_admin') { res.status(403).json({ success: false, code: 'SUPER_ADMIN_REQUIRED', message: '只有超级管理员可以处理经济贡献事件' }); return false }
  return true
}
function decision(contract: typeof ContributionContracts.accept | typeof ContributionContracts.reject | typeof ContributionContracts.revoke | typeof ContributionContracts.retryReward, handler: (req: any, body: { reason?: string }) => Promise<unknown>) {
  return asyncHandler(async (req: any, res: any) => {
    if (!requireSuperAdmin(req, res)) return
    try {
      const body = parseContractBody(contract, req.body ?? {}) as { reason?: string }
      sendContractData(res, contract, await handler(req, body))
    }
    catch (error) {
      if (error instanceof ContributionRewardError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
      throw error
    }
  })
}
platformContributionRouter.get('/', asyncHandler(async (req, res) => {
  if (!isPlatformAdministrator(req.user)) return res.status(403).json({ success: false, message: '仅平台管理员可查看贡献审计入口' })
  const query = parseContractQuery(ContributionContracts.audit, req.query)
  sendContractData(res, ContributionContracts.audit, await listContributionAudit(query.status, { ...query, skip: (query.page - 1) * query.pageSize }))
}))
platformContributionRouter.get('/:id/evidence', asyncHandler(async (req, res) => {
  if (!isPlatformAdministrator(req.user)) return res.status(403).json({ success: false, message: '仅平台管理员可查看贡献审计证据' })
  try {
    const query = parseContractQuery(ContributionContracts.evidence, req.query)
    sendContractData(res, ContributionContracts.evidence, await getContributionEvidence(req.params.id, query.kind))
  }
  catch (error) {
    if (error instanceof ContributionRewardError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
    throw error
  }
}))
platformContributionRouter.post('/:id/accept', decision(ContributionContracts.accept, req => acceptContribution(req.user.userId, req.params.id)))
platformContributionRouter.post('/:id/reject', decision(ContributionContracts.reject, (req, body) => rejectContribution(req.user.userId, req.params.id, body.reason || '')))
platformContributionRouter.post('/:id/revoke', decision(ContributionContracts.revoke, (req, body) => revokeContribution(req.user.userId, req.params.id, body.reason || '')))
platformContributionRouter.post('/:id/retry-reward', decision(ContributionContracts.retryReward, req => retryContributionReward(req.user.userId, req.params.id)))
