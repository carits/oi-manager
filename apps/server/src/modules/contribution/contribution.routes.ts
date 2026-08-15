import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { prisma } from '../../prisma'
import { hasOrganizationContext, isPlatformAdministrator } from '../featureAvailability'

export const contributionRouter = Router()

function requireOrganization(req: any, res: any) {
  const organizationId = String(req.params.organizationId || '')
  if (!hasOrganizationContext(req.user, organizationId)) {
    res.status(403).json({ success: false, message: '无权访问该校园的贡献排名' })
    return false
  }
  return true
}

async function rankingRows(organizationId?: string) {
  const groups = await prisma.contributionEvent.groupBy({
    by: ['actorUserId'],
    where: {
      status: 'accepted',
      revokedAt: null,
      ...(organizationId ? { Attribution: { is: { organizationId } } } : {}),
    },
    _sum: { score: true },
    orderBy: [{ _sum: { score: 'desc' } }, { actorUserId: 'asc' }],
  })
  if (groups.length === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: groups.map(group => group.actorUserId) }, status: 'active' },
    select: { id: true, username: true, avatar: true },
  })
  const byId = new Map(users.map(user => [user.id, user]))
  return groups.flatMap(group => {
    const user = byId.get(group.actorUserId)
    return user ? [{ id: user.id, userId: user.id, username: user.username, avatar: user.avatar, contributionScore: group._sum.score || 0 }] : []
  })
}

contributionRouter.get('/me/summary', asyncHandler(async (req, res) => {
  const eventCount = await prisma.contributionEvent.count({ where: { actorUserId: req.user!.userId, status: 'accepted', revokedAt: null } })
  res.json({ success: true, data: { eventCount } })
}))

contributionRouter.get('/me/events', asyncHandler(async (req, res) => {
  const events = await prisma.contributionEvent.findMany({
    where: { actorUserId: req.user!.userId, status: 'accepted', revokedAt: null },
    select: { id: true, type: true, sourceType: true, score: true, acceptedAt: true },
    orderBy: { acceptedAt: 'desc' },
  })
  res.json({ success: true, data: { items: events } })
}))

contributionRouter.get('/rankings/users', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { items: await rankingRows() } })
}))

contributionRouter.get('/organizations/:organizationId/rankings', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  res.json({ success: true, data: { items: await rankingRows(req.params.organizationId) } })
}))

contributionRouter.get('/organizations/:organizationId/events', asyncHandler(async (req, res) => {
  if (!requireOrganization(req, res)) return
  const events = await prisma.contributionEvent.findMany({
    where: { status: 'accepted', revokedAt: null, Attribution: { is: { organizationId: req.params.organizationId } } },
    select: { id: true, type: true, sourceType: true, score: true, acceptedAt: true, actorUserId: true },
    orderBy: { acceptedAt: 'desc' },
  })
  res.json({ success: true, data: { items: events } })
}))

contributionRouter.get('/platform', asyncHandler(async (req, res) => {
  if (!isPlatformAdministrator(req.user)) {
    return res.status(403).json({ success: false, message: '仅平台管理员可查看贡献审计入口' })
  }
  const events = await prisma.contributionEvent.findMany({
    select: { id: true, actorUserId: true, type: true, score: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  res.json({ success: true, data: { items: events } })
}))
