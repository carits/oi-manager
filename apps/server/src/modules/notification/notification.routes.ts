import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { getResourceScope } from '../../middleware/auth'
import { prisma } from '../../prisma'

export const notificationRouter = Router()

notificationRouter.get('/', asyncHandler(async (req, res) => {
  const user = req.user!
  const scope = getResourceScope(user)
  const rows = await prisma.userNotification.findMany({
    where: { userId: user.userId, scope },
    orderBy: { createdAt: 'desc' },
    take: 20
  })
  const unreadCount = await prisma.userNotification.count({ where: { userId: user.userId, scope, readAt: null } })
  res.json({ success: true, data: { notifications: rows, unreadCount } })
}))

notificationRouter.patch('/:id/read', asyncHandler(async (req, res) => {
  const user = req.user!
  const scope = getResourceScope(user)
  const result = await prisma.userNotification.updateMany({ where: { id: req.params.id, userId: user.userId, scope, readAt: null }, data: { readAt: new Date() } })
  if (!result.count) return res.status(404).json({ success: false, message: '通知不存在' })
  res.json({ success: true })
}))

notificationRouter.post('/read-all', asyncHandler(async (req, res) => {
  const user = req.user!
  const scope = getResourceScope(user)
  await prisma.userNotification.updateMany({ where: { userId: user.userId, scope, readAt: null }, data: { readAt: new Date() } })
  res.json({ success: true })
}))
