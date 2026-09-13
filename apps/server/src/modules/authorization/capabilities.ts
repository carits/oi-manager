import { prisma } from '../../prisma'

/**
 * Stable capability names used by domain policies. Authorization is derived
 * only from normalized role assignments and explicit capability grants.
 */
export type OrganizationCapability =
  | 'organization.view'
  | 'membership.view.students'
  | 'membership.view.teachers'
  | 'assignment.create'
  | 'assignment.manage'
  | 'contest.manage'
  | 'membership.manage.students'
  | 'membership.manage.teachers'
  | 'organization.settings'

export type TeamCapability = 'assignment.create' | 'assignment.manage' | 'contest.manage'

const ORGANIZATION_ROLE_CAPABILITIES: Readonly<Record<string, ReadonlySet<OrganizationCapability>>> = {
  student: new Set([
    'organization.view',
  ]),
  teacher: new Set([
    'organization.view',
    'membership.view.students',
    'assignment.create',
    'assignment.manage',
    'contest.manage',
    'membership.manage.students',
  ]),
  school_principal: new Set([
    'organization.view',
    'membership.view.students',
    'membership.view.teachers',
    'assignment.create',
    'assignment.manage',
    'contest.manage',
    'membership.manage.students',
    'membership.manage.teachers',
    'organization.settings',
  ]),
}

function capabilitiesFromRoles(roleKeys: string[]) {
  return new Set<OrganizationCapability>(roleKeys.flatMap(roleKey => [
    ...(ORGANIZATION_ROLE_CAPABILITIES[roleKey] ?? []),
  ]))
}

export interface OrganizationAuthorization {
  membershipId: string
  accountRole: string
  roleKeys: ReadonlySet<string>
  capabilities: ReadonlySet<OrganizationCapability>
}

const ORGANIZATION_CAPABILITY_KEYS = new Set<OrganizationCapability>([
  'organization.view',
  'membership.view.students',
  'membership.view.teachers',
  'assignment.create',
  'assignment.manage',
  'contest.manage',
  'membership.manage.students',
  'membership.manage.teachers',
  'organization.settings',
])

/** Resolve the normalized organization authorization facts for one active membership. */
export async function resolveOrganizationAuthorization(
  userId: string,
  organizationId: string,
): Promise<OrganizationAuthorization | null> {
  const [account, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } }),
    prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: {
        id: true,
        status: true,
        RoleAssignments: { select: { roleKey: true } },
        CapabilityGrants: { select: { capabilityKey: true } },
        Organization: { select: { status: true, School: { select: { directoryStatus: true } } } },
      },
    }),
  ])
  if (!account || account.status !== 'active' || !membership || membership.status !== 'active') return null
  if (membership.Organization.status !== 'active' || membership.Organization.School?.directoryStatus === 'legacy') return null

  const roleKeys = new Set(membership.RoleAssignments.map(item => item.roleKey))
  const capabilities = capabilitiesFromRoles([...roleKeys])
  for (const grant of membership.CapabilityGrants) {
    if (ORGANIZATION_CAPABILITY_KEYS.has(grant.capabilityKey as OrganizationCapability)) {
      capabilities.add(grant.capabilityKey as OrganizationCapability)
    }
  }
  return { membershipId: membership.id, accountRole: account.role, roleKeys, capabilities }
}

export interface OrganizationCapabilityOptions {
  /** Teachers may only manage resources they created; principals are unrestricted. */
  resourceCreatedByUserId?: string
  /** Creation flows need the membership row after authorization. */
  requireMembership?: boolean
}

export async function hasOrganizationCapability(
  userId: string,
  organizationId: string,
  capability: OrganizationCapability,
  options: OrganizationCapabilityOptions = {},
): Promise<boolean> {
  const authorization = await resolveOrganizationAuthorization(userId, organizationId)
  if (!authorization && !options.requireMembership) {
    const account = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } })
    return account?.status === 'active' && account.role === 'super_admin'
  }
  if (authorization?.accountRole === 'super_admin' && !options.requireMembership) return true
  if (!authorization?.capabilities.has(capability)) return false
  const normalizedPrincipal = authorization.roleKeys.has('school_principal')
  const teacherScoped = authorization.roleKeys.has('teacher') && !normalizedPrincipal
  if (
    teacherScoped
    && options.resourceCreatedByUserId
    && options.resourceCreatedByUserId !== userId
  ) return false
  return true
}

export async function hasTeamCapability(
  userId: string,
  teamId: string,
  _capability: TeamCapability,
): Promise<boolean> {
  const [account, team, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } }),
    prisma.team.findUnique({ where: { id: teamId }, select: { scope: true } }),
    prisma.teamMember.findFirst({
      where: { teamId, userId, status: 'active', role: { in: ['owner', 'admin'] } },
      select: { id: true },
    }),
  ])
  if (!account || account.status !== 'active' || !team) return false
  if (team.scope === 'campus' && account.role === 'super_admin') return true
  return Boolean(membership)
}

export function capabilitiesForOrganizationRole(roleKey: string): OrganizationCapability[] {
  return [...(ORGANIZATION_ROLE_CAPABILITIES[roleKey] ?? [])]
}
