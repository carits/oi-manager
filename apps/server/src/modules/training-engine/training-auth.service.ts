import { prisma } from '../../prisma'
import { hasOrganizationCapability, hasTeamCapability, resolveOrganizationAuthorization } from '../authorization/capabilities'

export function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  return hasTeamCapability(userId, teamId, 'contest.manage')
}

export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  const [user, team, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.team.findUnique({ where: { id: teamId }, select: { scope: true } }),
    prisma.teamMember.findFirst({ where: { teamId, userId, status: 'active' }, select: { id: true } }),
  ])
  if (team?.scope === 'campus' && ['super_admin', 'platform_admin'].includes(user?.role || '')) return true
  return Boolean(membership)
}

export function isOrganizationContestAdmin(userId: string, organizationId: string, createdBy?: string): Promise<boolean> {
  return hasOrganizationCapability(userId, organizationId, 'contest.manage', { resourceCreatedByUserId: createdBy })
}

export async function isOrganizationMember(userId: string, organizationId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!user) return false
  if (['super_admin', 'platform_admin'].includes(user.role)) return true
  return Boolean(await resolveOrganizationAuthorization(userId, organizationId))
}
