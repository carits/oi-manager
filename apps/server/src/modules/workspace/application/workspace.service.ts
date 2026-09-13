import crypto from 'crypto'
import { prisma } from '../../../prisma'
import { notificationService } from '../../notification/notification.service'
import { createOrganizationInvitation, respondToInvitation } from '../../organization-join/organization-join.service'
import { syncOrganizationMembershipBaseRole } from '../../authorization/membership-role-assignment'
import { organizationRoleFromRoleKeys } from '../../authorization/capabilities'

const allModules = ['overview', 'campus', 'management', 'teams', 'homeworks', 'contests', 'problems', 'problem-lists', 'rankings']
const platformModules = ['overview', 'schools', 'users', 'problems', 'submissions', 'oj-accounts']

export class WorkspaceError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code?: string) {
    super(message)
    this.name = 'WorkspaceError'
  }
}

export interface WorkspaceActor {
  userId: string
  role: string
  accountRole?: string
  organizationId?: string | null
  organizationMembershipId?: string | null
}

function modulesForRole(role: string) {
  if (role === 'school_principal') return allModules
  if (role === 'teacher') return allModules.filter(item => item !== 'problems')
  return ['overview', 'campus', 'teams', 'homeworks', 'contests', 'problem-lists', 'rankings']
}

function relationLabel(memberRole: string, relationType: string) {
  if (memberRole === 'school_principal') return '学校负责人'
  if (memberRole === 'teacher') return relationType === 'external_coach' ? '外聘教练' : '本校教师'
  if (relationType === 'preselected') return '预选学生'
  return '本校学生'
}

export async function listWorkspaces(actor: WorkspaceActor) {
  const accountRole = actor.accountRole || actor.role
  if (accountRole === 'super_admin' || accountRole === 'platform_admin') {
    return [{
      type: 'platform' as const,
      organizationName: accountRole === 'super_admin' ? '超级管理员' : '平台管理',
      memberRole: 'platform_admin',
      relationLabel: accountRole === 'super_admin' ? '超级管理员' : '平台管理员',
      availableModules: platformModules,
    }]
  }
  const rows = await prisma.organizationMembership.findMany({
    where: { userId: actor.userId, status: 'active', Organization: { status: 'active', OR: [
      { type: { not: 'school' } },
      { School: { is: { directoryStatus: { not: 'legacy' } } } },
    ] } },
    include: {
      Organization: { include: { School: { select: { id: true, shortName: true } } } },
      RoleAssignments: { select: { roleKey: true } },
    },
    orderBy: { joinedAt: 'asc' },
  })
  const organizations = rows.flatMap(row => {
    const organizationRole = organizationRoleFromRoleKeys(row.RoleAssignments.map(item => item.roleKey))
    if (!organizationRole) return []
    return [{
    organizationMembershipId: row.id,
    type: 'organization' as const,
    organizationId: row.organizationId,
    organizationName: row.Organization.name,
    organizationType: row.Organization.type,
    shortName: row.Organization.School?.shortName || null,
    memberRole: organizationRole,
    relationType: row.relationType,
    relationLabel: relationLabel(organizationRole, row.relationType),
    availableModules: modulesForRole(organizationRole),
  }]
  })
  const personal = {
    type: 'personal' as const,
    availableModules: ['overview', 'teams', 'problems', 'contests', 'problem-lists', 'rankings', 'submissions'],
  }
  return [...organizations, personal]
}

export async function inviteOrganizationMember(actor: WorkspaceActor, organizationId: string, body: any) {
  return createOrganizationInvitation(actor, organizationId, body || {})
}

export async function respondToOrganizationInvitation(actor: WorkspaceActor, invitationId: string, action: string) {
  const accept = action === 'accept'
  if (!accept && action !== 'reject') throw new WorkspaceError(400, '无效操作')
  const currentInvitation = await prisma.organizationInvitation.findUnique({ where: { id: invitationId }, select: { id: true } })
  if (currentInvitation) {
    await respondToInvitation(actor, invitationId, accept ? 'accept' : 'decline')
    return
  }
  const invitation = await prisma.organizationMembership.findFirst({
    where: { id: invitationId, userId: actor.userId, status: 'pending' },
    include: { Organization: { include: { School: { select: { directoryStatus: true } } } } },
  })
  if (!invitation) throw new WorkspaceError(404, '邀请不存在或已处理')
  if (invitation.Organization.type === 'school' && invitation.Organization.School?.directoryStatus === 'legacy') {
    throw new WorkspaceError(404, '该组织不可用', 'ORGANIZATION_NOT_AVAILABLE')
  }
  await prisma.$transaction(async tx => {
    await tx.organizationMembership.update({
      where: { id: invitation.id },
      data: { status: accept ? 'active' : 'rejected', joinedAt: accept ? new Date() : null },
    })
    if (!accept) return
    await syncOrganizationMembershipBaseRole(tx, invitation.id, invitation.memberRole, { source: 'legacy_invitation' })
    const user = await tx.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { username: true, avatar: true, email: true, phone: true, bio: true },
    })
    if (invitation.memberRole === 'student') {
      await tx.organizationStudentProfile.upsert({
        where: { membershipId: invitation.id },
        create: { id: crypto.randomUUID(), membershipId: invitation.id, name: user.username, avatar: user.avatar, status: 'active' },
        update: { status: 'active' },
      })
    } else {
      await tx.organizationTeacherProfile.upsert({
        where: { membershipId: invitation.id },
        create: {
          id: crypto.randomUUID(), membershipId: invitation.id, name: user.username, avatar: user.avatar,
          email: user.email, phone: user.phone, bio: user.bio, status: 'active',
        },
        update: { status: 'active' },
      })
    }
  })
  await notificationService.markSourceRead(actor.userId, 'campus', 'organization_invitation', invitation.id)
}
