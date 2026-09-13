import type { ContestFinalizationStatus, Prisma } from '@prisma/client'
import logger from '../../lib/logger'
import { ensureContestAggregateTx } from './contest-aggregate.service'

const finalizationRuntimeSelect = {
  id: true,
  type: true,
  status: true,
  finalizationStatus: true,
  finalizedStandingId: true,
} as const

async function lockContestFinalizationRuntimeTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
  consumer: string,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-finalize:${runtimeTrainingId}`}, 0)) IS NULL AS locked`
  const aggregate = await tx.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { select: finalizationRuntimeSelect } },
  })
  const runtime = aggregate?.RuntimeTraining
  if (!runtime) {
    const message = aggregate
      ? 'Contest aggregate has no runtime'
      : 'Contest runtime has no canonical aggregate'
    logger.error(aggregate ? 'contest_runtime_missing' : 'contest_aggregate_missing', new Error(message), {
      action: 'contest_command',
      metadata: { runtimeTrainingId, consumer, ...(aggregate ? { contestId: aggregate.id } : {}) },
    })
    return null
  }
  return runtime
}

export async function beginContestFinalizationTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
  expectedStatus: ContestFinalizationStatus,
) {
  const runtime = await lockContestFinalizationRuntimeTx(tx, runtimeTrainingId, 'rating_finalize_begin')
  if (!runtime) return false
  const updated = await tx.training.updateMany({
    where: {
      id: runtimeTrainingId,
      type: 'contest',
      finalizationStatus: expectedStatus,
    },
    data: { finalizationStatus: 'FINALIZING' },
  })
  return updated.count === 1
}

export async function completeContestFinalizationTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
  standingSnapshotId: string,
) {
  const runtime = await lockContestFinalizationRuntimeTx(tx, runtimeTrainingId, 'rating_finalize_complete')
  if (!runtime) return false
  const updated = await tx.training.updateMany({
    where: {
      id: runtimeTrainingId,
      type: 'contest',
      finalizationStatus: 'FINALIZING',
    },
    data: {
      finalizationStatus: 'FINALIZED',
      finalizedStandingId: standingSnapshotId,
      status: 'finished',
    },
  })
  if (!updated.count) return false
  await ensureContestAggregateTx(tx, runtimeTrainingId)
  return true
}

export async function failContestFinalizationTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
) {
  const runtime = await lockContestFinalizationRuntimeTx(tx, runtimeTrainingId, 'rating_finalize_failed')
  if (!runtime) return false
  const updated = await tx.training.updateMany({
    where: {
      id: runtimeTrainingId,
      type: 'contest',
      finalizationStatus: { in: ['LIVE', 'JUDGING'] },
    },
    data: { finalizationStatus: 'FAILED' },
  })
  return updated.count === 1
}

export async function completeContestRatingRebuildTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
  standingSnapshotId: string,
) {
  const runtime = await lockContestFinalizationRuntimeTx(tx, runtimeTrainingId, 'rating_rebuild_complete')
  if (!runtime) return false
  const updated = await tx.training.updateMany({
    where: {
      id: runtimeTrainingId,
      type: 'contest',
      finalizationStatus: 'HELD',
    },
    data: {
      finalizedStandingId: standingSnapshotId,
      finalizationStatus: 'FINALIZED',
    },
  })
  return updated.count === 1
}
