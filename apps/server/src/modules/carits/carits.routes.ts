import { Router, type Response } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { CaritsContracts } from '@oi-manager/contracts'
import { sendContractData } from '../../lib/api-contract'
import type { AuthRequest } from '../../middleware/auth'
import { isPlatformAdministrator } from '../featureAvailability'
import {
  CaritsApplicationError,
  getOrganizationCaritsAccount,
  getPersonalCaritsAccount,
  listPlatformCaritsAccounts,
} from './application/carits.service'

export const caritsRouter = Router()

function caritsEndpoint(handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try { await handler(req, res) }
    catch (error) {
      if (error instanceof CaritsApplicationError) {
        return res.status(error.statusCode).json({ success: false, message: error.message })
      }
      throw error
    }
  })
}

caritsRouter.get('/me', caritsEndpoint(async (req, res) => {
  sendContractData(res, CaritsContracts.personalAccount, await getPersonalCaritsAccount(req.user!.userId))
}))

caritsRouter.get('/me/transactions', caritsEndpoint(async (req, res) => {
  sendContractData(res, CaritsContracts.personalTransactions, await getPersonalCaritsAccount(req.user!.userId, true))
}))

caritsRouter.get('/organizations/:organizationId', caritsEndpoint(async (req, res) => {
  sendContractData(res, CaritsContracts.organizationAccount, await getOrganizationCaritsAccount(req.user!.userId, req.params.organizationId))
}))

caritsRouter.get('/organizations/:organizationId/transactions', caritsEndpoint(async (req, res) => {
  sendContractData(res, CaritsContracts.organizationTransactions, await getOrganizationCaritsAccount(req.user!.userId, req.params.organizationId, true))
}))

caritsRouter.get('/platform', caritsEndpoint(async (req, res) => {
  if (!isPlatformAdministrator(req.user)) {
    return res.status(403).json({ success: false, message: '仅平台管理员可查看 Carits币审计入口' })
  }
  sendContractData(res, CaritsContracts.platformAudit, await listPlatformCaritsAccounts())
}))
