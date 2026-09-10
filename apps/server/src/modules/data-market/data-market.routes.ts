import { Router } from 'express'
import type { AuthRequest } from '../../middleware/auth'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { CaritsLedgerError } from '../carits/application/carits-ledger.service'
import {
  confirmQualityIncident, createDataProduct, createQualityIncident, DataMarketError,
  getDataEntitlement, getDataProduct, listDataEntitlements, listDataProducts,
  getEntitlementManifest, listDataPurchases, listQualityIncidents, purchaseDataProduct, readEntitlementObject,
  resolveQualityIncident, upgradeDataEntitlement,
} from './data-market.service'

export const dataMarketRouter = Router()

function sendError(error: unknown, res: any) {
  if (error instanceof DataMarketError || error instanceof CaritsLedgerError) {
    return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
  }
  throw error
}

function route(handler: (req: AuthRequest) => Promise<unknown>, status = 200) {
  return asyncHandler(async (req: AuthRequest, res) => {
    try { return res.status(status).json({ success: true, data: await handler(req) }) }
    catch (error) { return sendError(error, res) }
  })
}

dataMarketRouter.get('/data-products', authenticate, route(req => listDataProducts(req.user!, req.query)))
dataMarketRouter.get('/data-products/:id', authenticate, route(req => getDataProduct(req.user!, req.params.id)))
dataMarketRouter.post('/problems/:problemId/data-products', authenticate, route(req => createDataProduct(req.user!, req.params.problemId, req.body), 201))
dataMarketRouter.post('/data-products/:id/purchase', authenticate, route(req => purchaseDataProduct(req.user!, req.params.id, req.body, String(req.header('Idempotency-Key') || '')), 201))
dataMarketRouter.get('/data-purchases', authenticate, route(req => listDataPurchases(req.user!)))
dataMarketRouter.get('/data-entitlements', authenticate, route(req => listDataEntitlements(req.user!)))
dataMarketRouter.get('/data-entitlements/:id', authenticate, route(req => getDataEntitlement(req.user!, req.params.id)))
dataMarketRouter.get('/data-entitlements/:id/revisions/:revisionId/manifest', authenticate, route(req => getEntitlementManifest(req.user!, req.params.id, req.params.revisionId)))
dataMarketRouter.get('/data-entitlements/:id/revisions/:revisionId/objects/:objectId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const object = await readEntitlementObject(req.user!, req.params.id, req.params.revisionId, req.params.objectId)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${object.fileName}"`)
    res.setHeader('ETag', `"${object.sha256}"`)
    return res.send(object.content)
  } catch (error) { return sendError(error, res) }
}))
dataMarketRouter.post('/data-entitlements/:id/upgrades', authenticate, route(req => upgradeDataEntitlement(req.user!, req.params.id, req.body), 201))
dataMarketRouter.post('/test-set-quality-incidents', authenticate, route(req => createQualityIncident(req.user!, req.body), 201))
dataMarketRouter.get('/problems/:problemId/test-set-quality-incidents', authenticate, route(req => listQualityIncidents(req.user!, req.params.problemId)))
dataMarketRouter.post('/test-set-quality-incidents/:id/confirm', authenticate, route(req => confirmQualityIncident(req.user!, req.params.id)))
dataMarketRouter.post('/test-set-quality-incidents/:id/resolve', authenticate, route(req => resolveQualityIncident(req.user!, req.params.id, req.body)))
