import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { getEvaluationResourceOverview, listEvaluationPackages, listEvaluationPurchases, purchaseEvaluationCredits, ResourcePurchaseError } from './application/resource-purchase.service'
import { CaritsLedgerError } from './application/carits-ledger.service'

export const resourceRouter = Router()

function sendError(error: unknown, res: any) {
  if (error instanceof ResourcePurchaseError || error instanceof CaritsLedgerError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
  throw error
}

resourceRouter.get('/evaluation-credit-packages', asyncHandler(async (_req, res) => res.json({ success: true, data: { items: listEvaluationPackages() } })))
resourceRouter.get('/evaluation-credits', asyncHandler(async (req: AuthRequest, res) => res.json({ success: true, data: await getEvaluationResourceOverview(req.user!.userId) })))
resourceRouter.get('/evaluation-credit-purchases', asyncHandler(async (req: AuthRequest, res) => res.json({ success: true, data: await listEvaluationPurchases(req.user!.userId) })))
resourceRouter.post('/evaluation-credits/purchase', asyncHandler(async (req: AuthRequest, res) => {
  try {
    const data = await purchaseEvaluationCredits({ userId: req.user!.userId, packageCode: String(req.body?.packageCode || ''), idempotencyKey: String(req.header('Idempotency-Key') || '') })
    res.status(201).json({ success: true, data: { ...data, caritsAmount: data.caritsAmount.toString() } })
  } catch (error) { return sendError(error, res) }
}))
