import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { getEvaluationResourceOverview, listEvaluationPackages, listEvaluationPurchases, purchaseEvaluationCredits, ResourcePurchaseError } from './application/resource-purchase.service'
import { CaritsLedgerError } from './application/carits-ledger.service'
import { EvaluationCreditContracts } from '@oi-manager/contracts'
import { parseContractBody, sendContractData } from '../../lib/api-contract'

export const resourceRouter = Router()

function sendError(error: unknown, res: any) {
  if (error instanceof ResourcePurchaseError || error instanceof CaritsLedgerError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
  throw error
}

resourceRouter.get('/evaluation-credit-packages', asyncHandler(async (_req, res) => sendContractData(res, EvaluationCreditContracts.packages, { items: listEvaluationPackages() })))
resourceRouter.get('/evaluation-credits', asyncHandler(async (req: AuthRequest, res) => sendContractData(res, EvaluationCreditContracts.overview, await getEvaluationResourceOverview(req.user!.userId))))
resourceRouter.get('/evaluation-credit-purchases', asyncHandler(async (req: AuthRequest, res) => sendContractData(res, EvaluationCreditContracts.purchases, await listEvaluationPurchases(req.user!.userId))))
resourceRouter.post('/evaluation-credits/purchase', asyncHandler(async (req: AuthRequest, res) => {
  try {
    const body = parseContractBody(EvaluationCreditContracts.purchase, req.body)
    const data = await purchaseEvaluationCredits({ userId: req.user!.userId, packageCode: body.packageCode, idempotencyKey: String(req.header('Idempotency-Key') || '') })
    sendContractData(res, EvaluationCreditContracts.purchase, { ...data, caritsAmount: data.caritsAmount.toString() }, 201)
  } catch (error) { return sendError(error, res) }
}))
