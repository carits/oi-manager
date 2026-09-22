import { prisma } from '../../../prisma'
import { createOrganizationInvitation, respondToInvitation } from '../../organization-join/organization-join.service'
import { organizationRoleFromRoleKeys } from '../../authorization/capabilities'
import type { WorkspaceSummary } from '@oi-manager/contracts'

const principalModules = ['overview', 'campus', 'management', 'teams', 'homeworks', 'contests', 'training-sessions', 'problems', 'problem-lists', 'rankings', 'submissions', 'knowledge']
const teacherModules = ['overview', 'campus', 'management', 'teams', 'homeworks', 'contests', 'training-sessions', 'problems', 'problem-lists', 'rankings', 'submissions', 'knowledge']
const studentModules = ['overview', 'campus', 'teams', 'homeworks', 'contests', 'training-sessions', 'problem-lists', 'rankings', 'submissions', 'knowledge']
const platformModules = ['overview', 'schools', 'users', 'problems', 'submissions', 'oj-accounts']

export class WorkspaceError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code?: string) {
    super(message)
    this.name = 'WorkspaceError'
  }
}

export interface WorkspaceActor {
  userId: string
  accountRole: string
  organizationId?: string | null
  organizationMembershipId?: string | null
}

function modulesForRole(role: string) {
  if (role === 'school_principal') return principalModules
  if (role === 'teacher') return teacherModules
  return studentModules
}

function relationLabel(memberRole: string, relationType: string) {
  if (memberRole === 'school_principal') return '学校负责人'
  if (memberRole === 'teacher') return relationType === 'external_coach' ? '外聘教练' : '本校教师'
  if (relationType === 'preselected') return '预选学生'
  return '本校学生'
}

export async function listWorkspaces(actor: WorkspaceActor): Promise<WorkspaceSummary[]> {
  const accountRole = actor.accountRole
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
    availableModules: ['overview', 'teams', 'problems', 'contests', 'training-sessions', 'problem-lists', 'rankings', 'submissions', 'knowledge'],
  }
  return [...organizations, personal]
}

export async function inviteOrganizationMember(actor: WorkspaceActor, organizationId: string, body: any) {
  return createOrganizationInvitation(actor, organizationId, body || {})
}

export async function respondToOrganizationInvitation(actor: WorkspaceActor, invitationId: string, action: string) {
  const accept = action === 'accept'
  if (!accept && action !== 'reject') throw new WorkspaceError(400, '无效操作')
  await respondToInvitation(actor, invitationId, accept ? 'accept' : 'decline')
}
