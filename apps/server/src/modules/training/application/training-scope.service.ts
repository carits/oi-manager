import { getResourceScope, isAdmin } from '../../../middleware/auth'
import { findActivityRuntimeForAccess } from '../../contest/contest-query.facade'

export async function trainingMatchesWorkspaceScope(trainingId: number, user: any) {
  const training = (await findActivityRuntimeForAccess(trainingId))?.runtime || null
  return Boolean(training && (
    isAdmin(user.role)
    || training.scope === 'platform'
    || training.scope === getResourceScope(user)
  ))
}
