import { getAccountRole, getResourceScope, isAdmin } from '../../../middleware/auth'
import { findActivityForAccess } from '../../contest/contest-query.facade'

export async function trainingMatchesWorkspaceScope(trainingId: number, user: any) {
  const training = (await findActivityForAccess(trainingId))?.activity || null
  if (!training) return false
  if (isAdmin(getAccountRole(user)!)) return true
  if (training.scope === 'platform') return true

  const resourceScope = getResourceScope(user)
  if (training.scope !== resourceScope) return false

  const teamOrganizationId = training.Team?.organizationId || null
  const resourceOrganizationId = training.organizationId || teamOrganizationId
  if (resourceScope === 'campus') {
    return Boolean(user.organizationId && resourceOrganizationId === user.organizationId)
  }
  return resourceOrganizationId == null
}
