import { Router, type Response } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
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
      if (error instanceof NotificationApplicationError) {
        return res.status(error.statusCode).json({ success: false, message: error.message })
      }
      throw error
    }
  })
}

notificationRouter.get('/', notificationEndpoint(async (req, res) => {
  res.json({ success: true, data: await listNotifications(req.user!, req.query) })
}))

notificationRouter.patch('/:id/read', notificationEndpoint(async (req, res) => {
  res.json({ success: true, data: await readNotification(req.user!, req.params.id, req.query) })
}))

notificationRouter.post('/read-all', notificationEndpoint(async (req, res) => {
  res.json({ success: true, data: await readAllNotifications(req.user!, req.query) })
}))
