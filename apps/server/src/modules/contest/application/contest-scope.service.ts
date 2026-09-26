import { getAccountRole, getResourceScope, isAdmin } from '../../../middleware/auth'
import { findContestForAccess } from '../../contest/contest-query.facade'

export async function contestMatchesWorkspaceScope(contestId: number, user: any) {
  const contest = (await findContestForAccess(contestId))?.contest || null
  if (!contest) return false
  if (isAdmin(getAccountRole(user)!)) return true
  if (contest.scope === 'platform') return true

  const resourceScope = getResourceScope(user)
  if (contest.scope !== resourceScope) return false

  const teamOrganizationId = contest.Team?.organizationId || null
  const resourceOrganizationId = contest.organizationId || teamOrganizationId
  if (resourceScope === 'campus') {
    return Boolean(user.organizationId && resourceOrganizationId === user.organizationId)
  }
  return resourceOrganizationId == null
}
