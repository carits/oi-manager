import { prisma } from '../../../prisma'
import { getResourceScope, isAdmin } from '../../../middleware/auth'

export async function trainingMatchesWorkspaceScope(trainingId: number, user: any) {
  const training = await prisma.training.findUnique({
    where: { id: trainingId },
    select: { scope: true },
  })
  return Boolean(training && (
    isAdmin(user.role)
    || training.scope === 'platform'
    || training.scope === getResourceScope(user)
  ))
}
