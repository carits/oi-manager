import { Router } from 'express'
import type { AuthRequest } from '../../middleware/auth'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { DataMarketContracts, type ApiEndpointContract } from '@oi-manager/contracts'
import type { ZodType } from 'zod'
import { parseContractBody, parseContractQuery, sendContractData } from '../../lib/api-contract'
import { CaritsLedgerError } from '../carits/application/carits-ledger.service'
import {
  confirmQualityIncident, createDataProduct, createQualityIncident, DataMarketError,
  getDataEntitlement, getDataProduct, listDataEntitlements, listDataProducts,
  getEntitlementManifest, listDataPurchases, listQualityIncidents, purchaseDataProduct, readEntitlementObject,
  resolveQualityIncident,
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

function contractRoute(contract: ApiEndpointContract<ZodType, ZodType, ZodType>, handler: (req: AuthRequest) => Promise<unknown>, status = 200) {
  return asyncHandler(async (req: AuthRequest, res) => {
    try { return sendContractData(res, contract, await handler(req), status) }
    catch (error) { return sendError(error, res) }
  })
}

dataMarketRouter.get('/data-products', authenticate, contractRoute(DataMarketContracts.products, req => listDataProducts(req.user!, parseContractQuery(DataMarketContracts.products, req.query))))
dataMarketRouter.get('/data-products/:id', authenticate, route(req => getDataProduct(req.user!, req.params.id)))
dataMarketRouter.post('/problems/:problemId/data-products', authenticate, contractRoute(DataMarketContracts.createProduct, req => createDataProduct(req.user!, req.params.problemId, parseContractBody(DataMarketContracts.createProduct, req.body)), 201))
dataMarketRouter.post('/data-products/:id/purchase', authenticate, contractRoute(DataMarketContracts.purchase, req => purchaseDataProduct(req.user!, req.params.id, parseContractBody(DataMarketContracts.purchase, req.body), String(req.header('Idempotency-Key') || '')), 201))
dataMarketRouter.get('/data-purchases', authenticate, route(req => listDataPurchases(req.user!)))
dataMarketRouter.get('/data-entitlements', authenticate, contractRoute(DataMarketContracts.entitlements, req => listDataEntitlements(req.user!)))
dataMarketRouter.get('/data-entitlements/:id', authenticate, route(req => getDataEntitlement(req.user!, req.params.id)))
dataMarketRouter.get('/data-entitlements/:id/manifest', authenticate, contractRoute(DataMarketContracts.manifest, req => getEntitlementManifest(req.user!, req.params.id)))
dataMarketRouter.get('/data-entitlements/:id/objects/:objectId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const object = await readEntitlementObject(req.user!, req.params.id, req.params.objectId)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${object.fileName}"`)
    res.setHeader('ETag', `"${object.sha256}"`)
    return res.send(object.content)
  } catch (error) { return sendError(error, res) }
}))
dataMarketRouter.post('/test-set-quality-incidents', authenticate, contractRoute(DataMarketContracts.createIncident, req => createQualityIncident(req.user!, parseContractBody(DataMarketContracts.createIncident, req.body)), 201))
dataMarketRouter.get('/problems/:problemId/test-set-quality-incidents', authenticate, contractRoute(DataMarketContracts.incidents, req => listQualityIncidents(req.user!, req.params.problemId)))
dataMarketRouter.post('/test-set-quality-incidents/:id/confirm', authenticate, contractRoute(DataMarketContracts.confirmIncident, req => { parseContractBody(DataMarketContracts.confirmIncident, req.body); return confirmQualityIncident(req.user!, req.params.id) }))
dataMarketRouter.post('/test-set-quality-incidents/:id/resolve', authenticate, contractRoute(DataMarketContracts.resolveIncident, req => resolveQualityIncident(req.user!, req.params.id, parseContractBody(DataMarketContracts.resolveIncident, req.body))))
