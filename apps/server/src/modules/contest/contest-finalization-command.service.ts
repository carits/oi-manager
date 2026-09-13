import type { ContestFinalizationStatus, Prisma } from '@prisma/client'
import logger from '../../lib/logger'
import { projectContestRuntimeTx } from './contest-aggregate.service'

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
  return { aggregate, runtime }
}

export async function beginContestFinalizationTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
  expectedStatus: ContestFinalizationStatus,
) {
  const locked = await lockContestFinalizationRuntimeTx(tx, runtimeTrainingId, 'rating_finalize_begin')
  if (!locked) return false
  const updated = await tx.contest.updateMany({
    where: {
      id: locked.aggregate.id,
      finalizationStatus: expectedStatus,
    },
    data: {
      finalizationStatus: 'FINALIZING',
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  if (updated.count !== 1) return false
  await projectContestRuntimeTx(tx, locked.aggregate.id)
  return true
}

export async function completeContestFinalizationTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
  standingSnapshotId: string,
) {
  const locked = await lockContestFinalizationRuntimeTx(tx, runtimeTrainingId, 'rating_finalize_complete')
  if (!locked) return false
  const updated = await tx.contest.updateMany({
    where: {
      id: locked.aggregate.id,
      finalizationStatus: 'FINALIZING',
    },
    data: {
      finalizationStatus: 'FINALIZED',
      finalizedStandingId: standingSnapshotId,
      status: 'finished',
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  if (!updated.count) return false
  await projectContestRuntimeTx(tx, locked.aggregate.id)
  return true
}

export async function failContestFinalizationTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
) {
  const locked = await lockContestFinalizationRuntimeTx(tx, runtimeTrainingId, 'rating_finalize_failed')
  if (!locked) return false
  const updated = await tx.contest.updateMany({
    where: {
      id: locked.aggregate.id,
      finalizationStatus: { in: ['LIVE', 'JUDGING'] },
    },
    data: {
      finalizationStatus: 'FAILED',
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  if (updated.count !== 1) return false
  await projectContestRuntimeTx(tx, locked.aggregate.id)
  return true
}

export async function completeContestRatingRebuildTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
  standingSnapshotId: string,
) {
  const locked = await lockContestFinalizationRuntimeTx(tx, runtimeTrainingId, 'rating_rebuild_complete')
  if (!locked) return false
  const updated = await tx.contest.updateMany({
    where: {
      id: locked.aggregate.id,
      finalizationStatus: 'HELD',
    },
    data: {
      finalizedStandingId: standingSnapshotId,
      finalizationStatus: 'FINALIZED',
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  if (updated.count !== 1) return false
  await projectContestRuntimeTx(tx, locked.aggregate.id)
  return true
}
