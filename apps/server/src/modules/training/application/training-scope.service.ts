import { getAccountRole, getResourceScope, isAdmin } from '../../../middleware/auth'
import { findActivityForAccess } from '../../contest/contest-query.facade'

export async function trainingMatchesWorkspaceScope(trainingId: number, user: any) {
  const training = (await findActivityForAccess(trainingId))?.activity || null
  return Boolean(training && (
    isAdmin(getAccountRole(user)!)
    || training.scope === 'platform'
    || training.scope === getResourceScope(user)
  ))
}
