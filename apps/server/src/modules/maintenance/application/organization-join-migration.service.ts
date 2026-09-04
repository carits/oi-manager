import { prisma } from '../../../prisma'

const normalizeRelationType = (role: string, value: string) => {
  if (role === 'teacher' || role === 'school_principal') return value === 'external_coach' ? 'external_coach' : 'employee'
  return value === 'preselected' ? 'preselected' : 'enrolled'
}

async function legacyInvitations() {
  return prisma.organizationMembership.findMany({
    where: { status: { in: ['pending', 'rejected'] }, invitedBy: { not: null } },
    include: { StudentProfile: { select: { id: true } }, TeacherProfile: { select: { id: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

export async function inspectOrganizationJoinMigration() {
  const memberships = await legacyInvitations()
  const inviterPairs = memberships.map(item => ({ organizationId: item.organizationId, userId: item.invitedBy! }))
  const senders = inviterPairs.length ? await prisma.organizationMembership.findMany({ where: { OR: inviterPairs, status: 'active' }, select: { id: true, organizationId: true, userId: true } }) : []
  const senderKeys = new Set(senders.map(item => `${item.organizationId}:${item.userId}`))
  const legacyNotifications = await prisma.userNotification.count({ where: { contextKey: 'legacy:campus' } })
  return {
    legacyInvitations: memberships.length,
    migratableInvitations: memberships.filter(item => senderKeys.has(`${item.organizationId}:${item.invitedBy}`) && !item.StudentProfile && !item.TeacherProfile).length,
    invitationAnomalies: memberships.filter(item => !senderKeys.has(`${item.organizationId}:${item.invitedBy}`) || item.StudentProfile || item.TeacherProfile).map(item => ({ membershipId: item.id, hasProfile: Boolean(item.StudentProfile || item.TeacherProfile), senderMissing: !senderKeys.has(`${item.organizationId}:${item.invitedBy}`) })),
    legacyNotifications,
    nonCanonicalRelations: await prisma.organizationMembership.count({ where: { relationType: { notIn: ['employee', 'external_coach', 'enrolled', 'preselected'] } } }),
  }
}

export async function applyOrganizationJoinMigration() {
  const memberships = await legacyInvitations()
  let invitationsMigrated = 0, relationsNormalized = 0, notificationsResolved = 0, notificationsRetired = 0
  const anomalies: Array<{ membershipId: string; reason: string }> = []
  for (const membership of memberships) {
    const sender = await prisma.organizationMembership.findFirst({ where: { organizationId: membership.organizationId, userId: membership.invitedBy!, status: 'active' } })
    if (!sender || membership.StudentProfile || membership.TeacherProfile) {
      anomalies.push({ membershipId: membership.id, reason: !sender ? 'inviter membership missing' : 'pending membership unexpectedly has profile' })
      continue
    }
    if (await prisma.organizationInvitation.findUnique({ where: { id: membership.id }, select: { id: true } })) continue
    await prisma.organizationInvitation.upsert({
      where: { id: membership.id },
      create: {
        id: membership.id, organizationId: membership.organizationId, userId: membership.userId,
        memberRole: membership.memberRole, relationType: normalizeRelationType(membership.memberRole, membership.relationType),
        invitedByUserId: membership.invitedBy!, invitedByMembershipId: sender.id,
        status: membership.status === 'pending' ? 'pending' : 'declined', respondedAt: membership.status === 'pending' ? null : membership.updatedAt,
        createdAt: membership.createdAt, updatedAt: membership.updatedAt,
      },
      update: {},
    })
    invitationsMigrated++
  }

  const relations = await prisma.organizationMembership.findMany({ where: { relationType: { notIn: ['employee', 'external_coach', 'enrolled', 'preselected'] } }, select: { id: true, memberRole: true, relationType: true } })
  for (const membership of relations) {
    const next = normalizeRelationType(membership.memberRole, membership.relationType)
    const result = await prisma.organizationMembership.updateMany({ where: { id: membership.id, relationType: membership.relationType }, data: { relationType: next } })
    relationsNormalized += result.count
  }

  const legacyNotifications = await prisma.userNotification.findMany({ where: { contextKey: 'legacy:campus' }, orderBy: { createdAt: 'asc' } })
  for (const notification of legacyNotifications) {
    let organizationId: string | null = null
    if (['team_invitation', 'team_join_request', 'team_join_decision', 'team_invitation_response'].includes(notification.type)) {
      const member = await prisma.teamMember.findUnique({ where: { id: notification.sourceId }, include: { Team: { select: { organizationId: true } } } })
      organizationId = member?.Team.organizationId || null
      if (!organizationId) {
        const request = await prisma.teamJoinRequest.findUnique({ where: { id: notification.sourceId }, include: { Team: { select: { organizationId: true } } } })
        organizationId = request?.Team.organizationId || null
      }
    }
    if (organizationId) {
      await prisma.userNotification.update({ where: { id: notification.id }, data: { contextType: 'organization', contextKey: `organization:${organizationId}`, organizationId } })
      notificationsResolved++
    } else {
      await prisma.userNotification.update({ where: { id: notification.id }, data: { contextType: 'account', contextKey: `retired:${notification.id}`, organizationId: null, readAt: notification.readAt || new Date(), href: null } })
      notificationsRetired++
    }
  }
  return { invitationsMigrated, relationsNormalized, notificationsResolved, notificationsRetired, anomalies }
}
