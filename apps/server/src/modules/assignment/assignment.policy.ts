import { prisma } from '../../prisma'
import { hasOrganizationCapability, hasTeamCapability } from '../authorization/capabilities'

export interface AssignmentPolicyResource {
  organizationId: string
  teamId: string | null
  creatorUserId: string
}

/** Domain policy for managing an assignment. Team administrators are allowed;
 * otherwise organization capability rules apply, preserving the legacy
 * teacher-owns-resource/principal-manages-all semantics. */
export async function canManageAssignmentResource(userId: string, resource: AssignmentPolicyResource) {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } })
  if (!account || account.status !== 'active') return false
  if (resource.teamId && await hasTeamCapability(userId, resource.teamId, 'assignment.manage')) return true
  return hasOrganizationCapability(userId, resource.organizationId, 'assignment.manage', {
    resourceCreatedByUserId: resource.creatorUserId,
  })
}
