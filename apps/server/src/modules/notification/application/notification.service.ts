import { getResourceScope } from '../../../middleware/auth'
import { prisma } from '../../../prisma'

type AuthUser = NonNullable<Express.Request['user']>

export class NotificationApplicationError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

export async function listNotifications(user: AuthUser) {
  const scope = getResourceScope(user)
  const rows = await prisma.userNotification.findMany({
    where: { userId: user.userId, scope }, orderBy: { createdAt: 'desc' }, take: 20,
  })
  const teamInvitationIds = rows.filter(row => row.type === 'team_invitation').map(row => row.sourceId)
  const joinRequestIds = rows.filter(row => row.type === 'team_join_request').map(row => row.sourceId)
  const organizationInvitationIds = rows.filter(row => row.type === 'organization_invitation').map(row => row.sourceId)
  const [teamMembers, administratorMemberships, organizationInvitations] = await Promise.all([
    teamInvitationIds.length || joinRequestIds.length
      ? prisma.teamMember.findMany({
          where: { id: { in: [...teamInvitationIds, ...joinRequestIds] } },
          select: { id: true, userId: true, teamId: true, status: true, invitedBy: true, Team: { select: { scope: true } } },
        })
      : [],
    joinRequestIds.length
      ? prisma.teamMember.findMany({
          where: { userId: user.userId, status: 'active', role: { in: ['owner', 'admin'] }, Team: { scope } },
          select: { teamId: true },
        })
      : [],
    organizationInvitationIds.length
      ? prisma.organizationMembership.findMany({
          where: { id: { in: organizationInvitationIds }, userId: user.userId }, select: { id: true, status: true },
        })
      : [],
  ])
  const teamMemberById = new Map(teamMembers.map(member => [member.id, member]))
  const administratorTeamIds = new Set(administratorMemberships.map(member => member.teamId))
  const organizationInvitationById = new Map(organizationInvitations.map(invitation => [invitation.id, invitation]))
  const actionableIds = new Set(rows.flatMap(row => {
    if (row.type === 'team_invitation') {
      const invitation = teamMemberById.get(row.sourceId)
      return invitation?.userId === user.userId && invitation.status === 'pending' && invitation.invitedBy !== null &&
        invitation.Team.scope === scope ? [row.id] : []
    }
    if (row.type === 'team_join_request') {
      const request = teamMemberById.get(row.sourceId)
      return request?.status === 'pending' && request.invitedBy === null && request.Team.scope === scope &&
        administratorTeamIds.has(request.teamId) ? [row.id] : []
    }
    if (row.type === 'organization_invitation') {
      return organizationInvitationById.get(row.sourceId)?.status === 'pending' ? [row.id] : []
    }
    return []
  }))
  const staleIds = rows.filter(row =>
    ['team_invitation', 'team_join_request', 'organization_invitation'].includes(row.type) &&
    !actionableIds.has(row.id) && !row.readAt).map(row => row.id)
  const markedAt = new Date()
  if (staleIds.length) {
    await prisma.userNotification.updateMany({ where: { id: { in: staleIds } }, data: { readAt: markedAt } })
  }
  const staleSet = new Set(staleIds)
  const notifications = rows.map(row => ({
    ...row,
    readAt: staleSet.has(row.id) ? markedAt : row.readAt,
    actionable: actionableIds.has(row.id),
  }))
  const unreadCount = await prisma.userNotification.count({ where: { userId: user.userId, scope, readAt: null } })
  return { notifications, unreadCount }
}

export async function readNotification(user: AuthUser, id: string) {
  const result = await prisma.userNotification.updateMany({
    where: { id, userId: user.userId, scope: getResourceScope(user), readAt: null }, data: { readAt: new Date() },
  })
  if (!result.count) throw new NotificationApplicationError(404, '通知不存在')
}

export async function readAllNotifications(user: AuthUser) {
  await prisma.userNotification.updateMany({
    where: { userId: user.userId, scope: getResourceScope(user), readAt: null }, data: { readAt: new Date() },
  })
}
