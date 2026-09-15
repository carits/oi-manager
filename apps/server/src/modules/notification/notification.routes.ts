import { Router, type Response } from 'express'
import { NotificationContracts } from '@oi-manager/contracts'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'
import type { AuthRequest } from '../../middleware/auth'
import {
  listNotifications,
  NotificationApplicationError,
  readAllNotifications,
  readNotification,
} from './application/notification.service'

export const notificationRouter = Router()

function notificationEndpoint(handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try { await handler(req, res) }
    catch (error) {
      if (sendContractError(error, res)) return
      if (error instanceof NotificationApplicationError) {
        return res.status(error.statusCode).json({ success: false, message: error.message })
      }
      throw error
    }
  })
}

notificationRouter.get('/', notificationEndpoint(async (req, res) => {
  const query = parseContractQuery(NotificationContracts.list, req.query)
  sendContractData(res, NotificationContracts.list, await listNotifications(req.user!, query))
}))

notificationRouter.patch('/:id/read', notificationEndpoint(async (req, res) => {
  parseContractBody(NotificationContracts.read, req.body || {})
  const query = parseContractQuery(NotificationContracts.read, req.query)
  sendContractData(res, NotificationContracts.read, await readNotification(req.user!, req.params.id, query))
}))

notificationRouter.post('/read-all', notificationEndpoint(async (req, res) => {
  parseContractBody(NotificationContracts.readAll, req.body || {})
  const query = parseContractQuery(NotificationContracts.readAll, req.query)
  sendContractData(res, NotificationContracts.readAll, await readAllNotifications(req.user!, query))
}))
