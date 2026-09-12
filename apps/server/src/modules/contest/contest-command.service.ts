import type { Prisma } from '@prisma/client'
import logger from '../../lib/logger'
import { ensureContestAggregateTx } from './contest-aggregate.service'

const rejudgeRuntimeSelect = {
  id: true,
  type: true,
  finalizationStatus: true,
  finalizedStandingId: true,
} as const

/**
 * Put a finalized contest into the explicit post-rejudge hold state.
 *
 * Training still owns the runtime/finalization columns during the Contest
 * strangler migration, but callers must not interpret or mutate those columns
 * directly. This command is the single compatibility boundary until the
 * fields move onto the canonical Contest aggregate.
 */
export async function holdContestFinalizationForRejudgeTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-command:${runtimeTrainingId}`}, 0)) IS NULL AS locked`

  const aggregate = await tx.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { select: rejudgeRuntimeSelect } },
  })

  if (aggregate && !aggregate.RuntimeTraining) {
    logger.error('contest_runtime_missing', new Error('Contest aggregate has no runtime'), {
      action: 'contest_command',
      metadata: { contestId: aggregate.id, runtimeTrainingId, consumer: 'rejudge' },
    })
    return false
  }

  const runtime = aggregate?.RuntimeTraining || await tx.training.findFirst({
    where: { id: runtimeTrainingId, type: 'contest' },
    select: rejudgeRuntimeSelect,
  })
  if (!runtime) return false
  if (runtime.type !== 'contest') {
    logger.error('contest_runtime_type_mismatch', new Error('Contest runtime is not a contest'), {
      action: 'contest_command',
      metadata: { contestId: aggregate?.id, runtimeTrainingId, consumer: 'rejudge' },
    })
    return false
  }
  if (!aggregate) {
    logger.warn('contest_command_legacy_fallback', {
      action: 'contest_command',
      metadata: { runtimeTrainingId, consumer: 'rejudge' },
    })
  }
  if (!runtime.finalizedStandingId || runtime.finalizationStatus !== 'FINALIZED') return false

  const updated = await tx.training.updateMany({
    where: {
      id: runtimeTrainingId,
      type: 'contest',
      finalizedStandingId: runtime.finalizedStandingId,
      finalizationStatus: 'FINALIZED',
    },
    data: { finalizationStatus: 'HELD' },
  })
  if (!updated.count) return false

  // A legacy fallback write heals the aggregate mapping in the same
  // transaction, so subsequent contest commands no longer need the fallback.
  if (!aggregate) await ensureContestAggregateTx(tx, runtimeTrainingId)
  return true
}
