import { prisma } from '../../prisma'

/**
 * Stable capability names used by domain policies. Membership roles are kept
 * as a compatibility input during the expand/backfill phase; callers must not
 * branch on memberRole directly.
 */
export type OrganizationCapability =
  | 'assignment.create'
  | 'assignment.manage'
  | 'contest.manage'
  | 'membership.manage.students'
  | 'membership.manage.teachers'
  | 'organization.settings'

export type TeamCapability = 'assignment.create' | 'assignment.manage' | 'contest.manage'

const LEGACY_ORGANIZATION_ROLE_CAPABILITIES: Readonly<Record<string, ReadonlySet<OrganizationCapability>>> = {
  teacher: new Set([
    'assignment.create',
    'assignment.manage',
    'contest.manage',
    'membership.manage.students',
  ]),
  school_principal: new Set([
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
    ...(LEGACY_ORGANIZATION_ROLE_CAPABILITIES[roleKey] ?? []),
  ]))
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
  const [account, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } }),
    prisma.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: {
        status: true,
        memberRole: true,
        RoleAssignments: { select: { roleKey: true } },
        CapabilityGrants: { select: { capabilityKey: true } },
        Organization: { select: { status: true, School: { select: { directoryStatus: true } } } },
      },
    }),
  ])

  if (!account || account.status !== 'active') return false
  if (account.role === 'super_admin' && !options.requireMembership) return true
  if (!membership || membership.status !== 'active') return false
  if (membership.Organization.status !== 'active' || membership.Organization.School?.directoryStatus === 'legacy') return false

  const roleSource = process.env.MEMBERSHIP_CAPABILITY_SOURCE || 'hybrid'
  const normalizedCapabilities = capabilitiesFromRoles(membership.RoleAssignments.map(item => item.roleKey))
  const explicitlyGranted = membership.CapabilityGrants.some(item => item.capabilityKey === capability)
  const legacyGranted = LEGACY_ORGANIZATION_ROLE_CAPABILITIES[membership.memberRole]?.has(capability) ?? false
  const allowed = roleSource === 'normalized'
    ? normalizedCapabilities.has(capability) || explicitlyGranted
    : roleSource === 'legacy'
      ? legacyGranted
      : legacyGranted || normalizedCapabilities.has(capability) || explicitlyGranted
  if (!allowed) return false
  const normalizedPrincipal = membership.RoleAssignments.some(item => item.roleKey === 'school_principal')
  const teacherScoped = membership.memberRole === 'teacher' && !normalizedPrincipal
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

export function capabilitiesForLegacyOrganizationRole(memberRole: string): OrganizationCapability[] {
  return [...(LEGACY_ORGANIZATION_ROLE_CAPABILITIES[memberRole] ?? [])]
}
