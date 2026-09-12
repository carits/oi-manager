import { getResourceScope } from '../../../middleware/auth'
import { prisma } from '../../../prisma'

type AuthUser = NonNullable<Express.Request['user']>

export class NotificationApplicationError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

function visibleNotificationWhere(user: AuthUser) {
  const scope = getResourceScope(user)
  const contexts = [{ contextKey: 'account' }]
  if (user.organizationId) contexts.push({ contextKey: `organization:${user.organizationId}` })
  return { userId: user.userId, OR: [...contexts, { contextKey: 'legacy:campus', scope }] }
}

async function resolveNotificationRows(user: AuthUser, rows: Awaited<ReturnType<typeof prisma.userNotification.findMany>>) {
  const scope = getResourceScope(user)
  const teamInvitationIds = rows.filter(row => row.type === 'team_invitation').map(row => row.sourceId)
  const joinRequestIds = rows.filter(row => row.type === 'team_join_request').map(row => row.sourceId)
  const organizationInvitationIds = rows.filter(row => row.type === 'organization_invitation').map(row => row.sourceId)
  const joinApplicationIds = rows.filter(row => row.type === 'organization_join_application_received').map(row => row.sourceId)
  const creationApplicationIds = rows.filter(row => row.type === 'organization_creation_application_received').map(row => row.sourceId)
  const [teamMembers, administratorMemberships, organizationInvitations, legacyOrganizationInvitations, joinApplications, creationApplications] = await Promise.all([
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
    organizationInvitationIds.length ? prisma.organizationInvitation.findMany({
      where: { id: { in: organizationInvitationIds }, userId: user.userId }, select: { id: true, status: true, expiresAt: true },
    }) : [],
    organizationInvitationIds.length
      ? prisma.organizationMembership.findMany({
          where: { id: { in: organizationInvitationIds }, userId: user.userId }, select: { id: true, status: true },
        })
      : [],
    joinApplicationIds.length ? prisma.organizationJoinApplication.findMany({
      where: { id: { in: joinApplicationIds }, organizationId: user.organizationId || '__none__' }, select: { id: true, status: true },
    }) : [],
    creationApplicationIds.length && user.role === 'super_admin' ? prisma.organizationCreationApplication.findMany({
      where: { id: { in: creationApplicationIds } }, select: { id: true, status: true },
    }) : [],
  ])
  const teamMemberById = new Map(teamMembers.map(member => [member.id, member]))
  const administratorTeamIds = new Set(administratorMemberships.map(member => member.teamId))
  const organizationInvitationById = new Map([...legacyOrganizationInvitations, ...organizationInvitations].map(invitation => [invitation.id, invitation]))
  const joinApplicationById = new Map(joinApplications.map(application => [application.id, application]))
  const creationApplicationById = new Map(creationApplications.map(application => [application.id, application]))
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
      const invitation = organizationInvitationById.get(row.sourceId)
      return invitation?.status === 'pending' && (!('expiresAt' in invitation) || !invitation.expiresAt || invitation.expiresAt > new Date()) ? [row.id] : []
    }
    if (row.type === 'organization_join_application_received') {
      return joinApplicationById.get(row.sourceId)?.status === 'pending' ? [row.id] : []
    }
    if (row.type === 'organization_creation_application_received') {
      return creationApplicationById.get(row.sourceId)?.status === 'pending' ? [row.id] : []
    }
    return []
  }))
  const staleIds = rows.filter(row =>
    ['team_invitation', 'team_join_request', 'organization_invitation', 'organization_join_application_received', 'organization_creation_application_received'].includes(row.type) &&
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
    actions: !actionableIds.has(row.id) ? [] : row.type === 'organization_invitation' || row.type === 'team_invitation'
      ? [{ key: 'decline', label: '拒绝', style: 'secondary' }, { key: 'accept', label: '接受', style: 'primary' }]
      : row.type === 'organization_join_application_received' || row.type === 'organization_creation_application_received'
        ? [{ key: 'view', label: '查看', style: 'primary' }]
        : [{ key: 'reject', label: '拒绝', style: 'secondary' }, { key: 'approve', label: '同意', style: 'primary' }],
  }))
  return notifications
}

export async function listNotifications(user: AuthUser, query: Record<string, unknown> = {}) {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || query.take) || 20))
  const filter = ['all', 'unread', 'actionable'].includes(String(query.filter)) ? String(query.filter) : 'all'
  const visible = visibleNotificationWhere(user)
  let notifications: Awaited<ReturnType<typeof resolveNotificationRows>> = []
  let hasMore = false

  if (filter === 'actionable') {
    // Actionability depends on the live source record, so raw notification pages cannot be
    // treated as actionable pages. Scan until this requested logical page is filled or the
    // visible stream is exhausted; this prevents an actionable item after 50 ordinary rows
    // from being hidden behind a false empty state.
    const required = page * pageSize + 1
    const actionable: Awaited<ReturnType<typeof resolveNotificationRows>> = []
    let offset = 0
    const batchSize = 100
    while (actionable.length < required) {
      const rows = await prisma.userNotification.findMany({
        where: visible,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: batchSize,
      })
      if (!rows.length) break
      const resolved = await resolveNotificationRows(user, rows)
      actionable.push(...resolved.filter(row => row.actionable))
      offset += rows.length
      if (rows.length < batchSize) break
    }
    const start = (page - 1) * pageSize
    notifications = actionable.slice(start, start + pageSize)
    hasMore = actionable.length > start + pageSize
  } else {
    const fetchedRows = await prisma.userNotification.findMany({
      where: { ...visible, ...(filter === 'unread' ? { readAt: null } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
    })
    hasMore = fetchedRows.length > pageSize
    notifications = await resolveNotificationRows(user, fetchedRows.slice(0, pageSize))
  }
  const unreadCount = await prisma.userNotification.count({ where: { ...visible, readAt: null } })
  return { notifications, unreadCount, page, pageSize, hasMore }
}

export async function readNotification(user: AuthUser, id: string) {
  const existing = await prisma.userNotification.findFirst({ where: { id, ...visibleNotificationWhere(user) }, select: { id: true } })
  if (!existing) throw new NotificationApplicationError(404, '通知不存在')
  const result = await prisma.userNotification.updateMany({
    where: { id, ...visibleNotificationWhere(user), readAt: null }, data: { readAt: new Date() },
  })
  const unreadCount = await prisma.userNotification.count({ where: { ...visibleNotificationWhere(user), readAt: null } })
  return { changed: Boolean(result.count), unreadCount }
}

export async function readAllNotifications(user: AuthUser) {
  const result = await prisma.userNotification.updateMany({
    where: { ...visibleNotificationWhere(user), readAt: null }, data: { readAt: new Date() },
  })
  return { changed: result.count, unreadCount: 0 }
}
