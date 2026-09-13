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
  userId: string
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
type AuthorizationClient = {
  user: typeof prisma.user
  organizationMembership: typeof prisma.organizationMembership
}

function authorizationFromMembership(accountRole: string, membership: {
  id: string
  userId: string
  RoleAssignments: Array<{ roleKey: string }>
  CapabilityGrants: Array<{ capabilityKey: string }>
}): OrganizationAuthorization {
  const roleKeys = new Set(membership.RoleAssignments.map(item => item.roleKey))
  const capabilities = capabilitiesFromRoles([...roleKeys])
  for (const grant of membership.CapabilityGrants) {
    if (ORGANIZATION_CAPABILITY_KEYS.has(grant.capabilityKey as OrganizationCapability)) {
      capabilities.add(grant.capabilityKey as OrganizationCapability)
    }
  }
  return { userId: membership.userId, membershipId: membership.id, accountRole, roleKeys, capabilities }
}

export async function resolveOrganizationAuthorization(
  userId: string,
  organizationId: string,
  client: AuthorizationClient = prisma as AuthorizationClient,
): Promise<OrganizationAuthorization | null> {
  const [account, membership] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { role: true, status: true } }),
    client.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: {
        id: true,
        userId: true,
        status: true,
        RoleAssignments: { select: { roleKey: true } },
        CapabilityGrants: { select: { capabilityKey: true } },
        Organization: { select: { status: true, School: { select: { directoryStatus: true } } } },
      },
    }),
  ])
  if (!account || account.status !== 'active' || !membership || membership.status !== 'active') return null
  if (membership.Organization.status !== 'active' || membership.Organization.School?.directoryStatus === 'legacy') return null
  return authorizationFromMembership(account.role, membership)
}

/** Resolve every active organization authorization for one account in one query. */
export async function resolveOrganizationAuthorizationsForUser(
  userId: string,
  organizationIds?: string[],
  client: AuthorizationClient = prisma as AuthorizationClient,
): Promise<Array<OrganizationAuthorization & { organizationId: string }>> {
  const account = await client.user.findUnique({ where: { id: userId }, select: { role: true, status: true } })
  if (!account || account.status !== 'active') return []
  const memberships = await client.organizationMembership.findMany({
    where: {
      userId,
      status: 'active',
      ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
      Organization: { status: 'active', School: { is: { directoryStatus: { not: 'legacy' } } } },
    },
    select: {
      id: true,
      userId: true,
      organizationId: true,
      RoleAssignments: { select: { roleKey: true } },
      CapabilityGrants: { select: { capabilityKey: true } },
    },
  })
  return memberships.map(membership => ({
    ...authorizationFromMembership(account.role, membership),
    organizationId: membership.organizationId,
  }))
}

/** Resolve active members that hold a capability; used for notifications and policy projections. */
export async function resolveOrganizationAuthorizationsForOrganization(
  organizationId: string,
  client: AuthorizationClient = prisma as AuthorizationClient,
): Promise<OrganizationAuthorization[]> {
  const memberships = await client.organizationMembership.findMany({
    where: {
      organizationId,
      status: 'active',
      User: { status: 'active' },
      Organization: { status: 'active', School: { is: { directoryStatus: { not: 'legacy' } } } },
    },
    select: {
      id: true,
      userId: true,
      User: { select: { role: true } },
      RoleAssignments: { select: { roleKey: true } },
      CapabilityGrants: { select: { capabilityKey: true } },
    },
  })
  return memberships.map(membership => authorizationFromMembership(membership.User.role, membership))
}

const RESOURCE_SCOPED_CAPABILITIES = new Set<OrganizationCapability>([
  'assignment.manage',
  'contest.manage',
  'membership.manage.students',
])

/** Default teacher roles manage their own resources; principals and explicit non-teacher grants are broad. */
export function organizationCapabilityScope(
  authorization: OrganizationAuthorization,
  capability: OrganizationCapability,
): 'none' | 'own' | 'all' {
  if (!authorization.capabilities.has(capability)) return 'none'
  if (
    RESOURCE_SCOPED_CAPABILITIES.has(capability)
    && authorization.roleKeys.has('teacher')
    && !authorization.roleKeys.has('school_principal')
  ) return 'own'
  return 'all'
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
  if (
    organizationCapabilityScope(authorization, capability) === 'own'
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
