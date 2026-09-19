import { getResourceScope } from '../../../middleware/auth'
import { prisma } from '../../../prisma'

type AuthUser = NonNullable<Express.Request['user']>

export class NotificationApplicationError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

function isAccountView(query: Record<string, unknown>) {
  return query.view === 'account'
}

async function notificationAccess(user: AuthUser, query: Record<string, unknown> = {}) {
  if (isAccountView(query)) {
    const memberships = await prisma.organizationMembership.findMany({
      where: {
        userId: user.userId,
        status: 'active',
        Organization: {
          status: 'active',
          OR: [{ type: { not: 'school' } }, { School: { directoryStatus: { not: 'legacy' } } }],
        },
      },
      select: { organizationId: true },
    })
    const organizationIds = [...new Set(memberships.map(item => item.organizationId))]
    return {
      organizationIds,
      where: {
        userId: user.userId,
        OR: [
          { contextKey: 'account' },
          ...organizationIds.map(organizationId => ({ contextKey: `organization:${organizationId}` })),
        ],
      },
    }
  }
  const contexts = [{ contextKey: 'account' }]
  if (user.organizationId) contexts.push({ contextKey: `organization:${user.organizationId}` })
  return {
    organizationIds: user.organizationId ? [user.organizationId] : [],
    where: { userId: user.userId, OR: contexts },
  }
}

async function resolveNotificationRows(
  user: AuthUser,
  rows: Awaited<ReturnType<typeof prisma.userNotification.findMany>>,
  organizationIds: string[],
  accountView: boolean,
) {
  const scope = getResourceScope(user)
  const teamInvitationIds = rows.filter(row => row.type === 'team_invitation').map(row => row.sourceId)
  const joinRequestIds = rows.filter(row => row.type === 'team_join_request').map(row => row.sourceId)
  const organizationInvitationIds = rows.filter(row => row.type === 'organization_invitation').map(row => row.sourceId)
  const joinApplicationIds = rows.filter(row => row.type === 'organization_join_application_received').map(row => row.sourceId)
  const creationApplicationIds = rows.filter(row => row.type === 'organization_creation_application_received').map(row => row.sourceId)
  const rowOrganizationIds = [...new Set(rows.flatMap(row => {
    if (row.organizationId) return [row.organizationId]
    const match = row.contextKey.match(/^organization:(.+)$/)
    return match ? [match[1]] : []
  }))]
  const [teamMembers, administratorMemberships, organizationInvitations, joinApplications, creationApplications, organizations] = await Promise.all([
    teamInvitationIds.length || joinRequestIds.length
      ? prisma.teamMember.findMany({
          where: { id: { in: [...teamInvitationIds, ...joinRequestIds] } },
          select: { id: true, userId: true, teamId: true, status: true, invitedBy: true, Team: { select: { scope: true, organizationId: true } } },
        })
      : [],
    joinRequestIds.length
      ? prisma.teamMember.findMany({
          where: {
            userId: user.userId,
            status: 'active',
            role: { in: ['owner', 'admin'] },
            Team: accountView
              ? { OR: [{ scope: 'personal' }, { scope: 'campus', organizationId: { in: organizationIds } }] }
              : { scope },
          },
          select: { teamId: true },
        })
      : [],
    organizationInvitationIds.length ? prisma.organizationInvitation.findMany({
      where: { id: { in: organizationInvitationIds }, userId: user.userId }, select: { id: true, status: true, expiresAt: true },
    }) : [],
    joinApplicationIds.length ? prisma.organizationJoinApplication.findMany({
      where: {
        id: { in: joinApplicationIds },
        organizationId: accountView ? { in: organizationIds } : (user.organizationId || '__none__'),
      }, select: { id: true, status: true },
    }) : [],
    creationApplicationIds.length && user.accountRole === 'super_admin' ? prisma.organizationCreationApplication.findMany({
      where: { id: { in: creationApplicationIds } }, select: { id: true, status: true },
    }) : [],
    rowOrganizationIds.length ? prisma.organization.findMany({
      where: { id: { in: rowOrganizationIds } }, select: { id: true, name: true },
    }) : [],
  ])
  const teamMemberById = new Map(teamMembers.map(member => [member.id, member]))
  const administratorTeamIds = new Set(administratorMemberships.map(member => member.teamId))
  const organizationInvitationById = new Map(organizationInvitations.map(invitation => [invitation.id, invitation]))
  const joinApplicationById = new Map(joinApplications.map(application => [application.id, application]))
  const creationApplicationById = new Map(creationApplications.map(application => [application.id, application]))
  const actionableIds = new Set(rows.flatMap(row => {
    if (row.type === 'team_invitation') {
      const invitation = teamMemberById.get(row.sourceId)
      const visibleTeam = accountView
        ? invitation?.Team.scope === 'personal' || Boolean(invitation?.Team.organizationId && organizationIds.includes(invitation.Team.organizationId))
        : invitation?.Team.scope === scope
      return invitation?.userId === user.userId && invitation.status === 'pending' && invitation.invitedBy !== null && visibleTeam ? [row.id] : []
    }
    if (row.type === 'team_join_request') {
      const request = teamMemberById.get(row.sourceId)
      const visibleTeam = accountView
        ? request?.Team.scope === 'personal' || Boolean(request?.Team.organizationId && organizationIds.includes(request.Team.organizationId))
        : request?.Team.scope === scope
      return request?.status === 'pending' && request.invitedBy === null && visibleTeam &&
        administratorTeamIds.has(request.teamId) ? [row.id] : []
    }
    if (row.type === 'organization_invitation') {
      const invitation = organizationInvitationById.get(row.sourceId)
      return invitation?.status === 'pending' && (!invitation.expiresAt || invitation.expiresAt > new Date()) ? [row.id] : []
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
  const organizationById = new Map(organizations.map(organization => [organization.id, organization.name]))
  const notifications = rows.map(row => {
    const organizationId = row.organizationId || row.contextKey.match(/^organization:(.+)$/)?.[1] || null
    return ({
    ...row, organizationId,
    organizationName: organizationId ? organizationById.get(organizationId) || null : null,
    readAt: staleSet.has(row.id) ? markedAt : row.readAt,
    actionable: actionableIds.has(row.id),
    actions: !actionableIds.has(row.id) ? [] : row.type === 'organization_invitation' || row.type === 'team_invitation'
      ? [{ key: 'decline', label: '拒绝', style: 'secondary' }, { key: 'accept', label: '接受', style: 'primary' }]
      : row.type === 'organization_join_application_received' || row.type === 'organization_creation_application_received'
        ? [{ key: 'view', label: '查看', style: 'primary' }]
        : [{ key: 'reject', label: '拒绝', style: 'secondary' }, { key: 'approve', label: '同意', style: 'primary' }],
  })})
  return notifications
}

export async function listNotifications(user: AuthUser, query: Record<string, unknown> = {}) {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || query.take) || 20))
  const filter = ['all', 'unread', 'actionable'].includes(String(query.filter)) ? String(query.filter) : 'all'
  const accountView = isAccountView(query)
  const access = await notificationAccess(user, query)
  const visible = access.where
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
      const resolved = await resolveNotificationRows(user, rows, access.organizationIds, accountView)
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
    notifications = await resolveNotificationRows(user, fetchedRows.slice(0, pageSize), access.organizationIds, accountView)
  }
  const unreadCount = await prisma.userNotification.count({ where: { ...visible, readAt: null } })
  return { notifications, unreadCount, page, pageSize, hasMore }
}

export async function readNotification(user: AuthUser, id: string, query: Record<string, unknown> = {}) {
  const visible = (await notificationAccess(user, query)).where
  const existing = await prisma.userNotification.findFirst({ where: { id, ...visible }, select: { id: true } })
  if (!existing) throw new NotificationApplicationError(404, '通知不存在')
  const result = await prisma.userNotification.updateMany({
    where: { id, ...visible, readAt: null }, data: { readAt: new Date() },
  })
  const unreadCount = await prisma.userNotification.count({ where: { ...visible, readAt: null } })
  return { changed: Boolean(result.count), unreadCount }
}

export async function readAllNotifications(user: AuthUser, query: Record<string, unknown> = {}) {
  const visible = (await notificationAccess(user, query)).where
  const result = await prisma.userNotification.updateMany({
    where: { ...visible, readAt: null }, data: { readAt: new Date() },
  })
  return { changed: result.count, unreadCount: 0 }
}
