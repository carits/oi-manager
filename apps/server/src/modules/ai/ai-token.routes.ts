import { Router } from 'express'
import { AiGovernanceContracts } from '@oi-manager/contracts'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import { isPlatformAdministrator } from '../featureAvailability'
import { adjustAiTokenPool, AiTokenError, getAiTokenPool, listAiTokenUsage } from './ai-token.service'
import { getEvaluationBudgetOverview } from '../problem/problem.evaluation-budget.service'
export const aiTokenAdminRouter = Router()
function guard(req: any, res: any) { if (!isPlatformAdministrator(req.user)) { res.status(403).json({ success: false, message: '仅平台管理员可管理 AI Token' }); return false } return true }
function send(error: unknown, res: any) { if (!(error instanceof AiTokenError)) throw error; return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message }) }
aiTokenAdminRouter.get('/token-pool', asyncHandler(async (req, res) => { if (!guard(req, res)) return; sendContractData(res, AiGovernanceContracts.tokenPool, await getAiTokenPool()) }))
aiTokenAdminRouter.get('/token-usage', asyncHandler(async (req, res) => { if (!guard(req, res)) return; sendContractData(res, AiGovernanceContracts.tokenUsage, await listAiTokenUsage()) }))
aiTokenAdminRouter.get('/evaluation-budget', asyncHandler(async (req, res) => { if (!guard(req, res)) return; sendContractData(res, AiGovernanceContracts.evaluationBudget, await getEvaluationBudgetOverview()) }))
aiTokenAdminRouter.post('/token-pool/adjust', asyncHandler(async (req, res) => {
  if (!guard(req, res)) return
  try {
    const body = parseContractBody(AiGovernanceContracts.adjustTokenPool, req.body)
    sendContractData(res, AiGovernanceContracts.adjustTokenPool, await adjustAiTokenPool({ ...body, operatorUserId: req.user!.userId }))
  } catch (error) {
    if (sendContractError(error, res)) return
    return send(error, res)
  }
}))
