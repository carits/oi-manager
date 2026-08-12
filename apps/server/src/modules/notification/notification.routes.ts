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
  const teamInvitationIds = rows.filter(row => row.type === 'team_invitation').map(row => row.sourceId)
  const joinRequestIds = rows.filter(row => row.type === 'team_join_request').map(row => row.sourceId)
  const organizationInvitationIds = rows.filter(row => row.type === 'organization_invitation').map(row => row.sourceId)
  const [teamMembers, administratorMemberships, organizationInvitations] = await Promise.all([
    teamInvitationIds.length || joinRequestIds.length
      ? prisma.teamMember.findMany({ where: { id: { in: [...teamInvitationIds, ...joinRequestIds] } }, select: { id: true, userId: true, teamId: true, status: true, invitedBy: true, Team: { select: { scope: true } } } })
      : [],
    joinRequestIds.length
      ? prisma.teamMember.findMany({ where: { userId: user.userId, status: 'active', role: { in: ['owner', 'admin'] }, Team: { scope } }, select: { teamId: true } })
      : [],
    organizationInvitationIds.length
      ? prisma.organizationMembership.findMany({ where: { id: { in: organizationInvitationIds }, userId: user.userId }, select: { id: true, status: true } })
      : []
  ])
  const teamMemberById = new Map(teamMembers.map(member => [member.id, member]))
  const administratorTeamIds = new Set(administratorMemberships.map(member => member.teamId))
  const organizationInvitationById = new Map(organizationInvitations.map(invitation => [invitation.id, invitation]))
  const actionableNotificationIds = new Set(rows.flatMap(row => {
    if (row.type === 'team_invitation') {
      const invitation = teamMemberById.get(row.sourceId)
      return invitation?.userId === user.userId && invitation.status === 'pending' && invitation.invitedBy !== null && invitation.Team.scope === scope ? [row.id] : []
    }
    if (row.type === 'team_join_request') {
      const request = teamMemberById.get(row.sourceId)
      return request?.status === 'pending' && request.invitedBy === null && request.Team.scope === scope && administratorTeamIds.has(request.teamId) ? [row.id] : []
    }
    if (row.type === 'organization_invitation') {
      return organizationInvitationById.get(row.sourceId)?.status === 'pending' ? [row.id] : []
    }
    return []
  }))
  const staleActionNotificationIds = rows
    .filter(row => (row.type === 'team_invitation' || row.type === 'team_join_request' || row.type === 'organization_invitation') && !actionableNotificationIds.has(row.id) && !row.readAt)
    .map(row => row.id)
  if (staleActionNotificationIds.length) {
    await prisma.userNotification.updateMany({ where: { id: { in: staleActionNotificationIds } }, data: { readAt: new Date() } })
  }
  const readAt = new Date().toISOString()
  const notifications = rows.map(row => ({ ...row, readAt: staleActionNotificationIds.includes(row.id) ? readAt : row.readAt, actionable: actionableNotificationIds.has(row.id) }))
  const unreadCount = await prisma.userNotification.count({ where: { userId: user.userId, scope, readAt: null } })
  res.json({ success: true, data: { notifications, unreadCount } })
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
