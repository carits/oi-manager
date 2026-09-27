import type { ContestFinalizationStatus, Prisma } from '@prisma/client'
import logger from '../../lib/logger'
import { releaseTestSetReaderTx } from '../problem/problem.testset-slot.service'

async function lockContestFinalizationTx(
  tx: Prisma.TransactionClient,
  publicId: number,
  consumer: string,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-finalize:${publicId}`}, 0)) IS NULL AS locked`
  const contest = await tx.contest.findUnique({ where: { publicId } })
  if (!contest) {
    logger.error('contest_missing', new Error('Contest does not exist'), {
      action: 'contest_command',
      metadata: { publicId, consumer },
    })
    return null
  }
  return contest
}

export async function beginContestFinalizationTx(
  tx: Prisma.TransactionClient,
  publicId: number,
  expectedStatus: ContestFinalizationStatus,
) {
  const contest = await lockContestFinalizationTx(tx, publicId, 'rating_finalize_begin')
  if (!contest) return false
  const updated = await tx.contest.updateMany({
    where: { id: contest.id, finalizationStatus: expectedStatus },
    data: {
      finalizationStatus: 'FINALIZING',
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  return updated.count === 1
}

export async function completeContestFinalizationTx(
  tx: Prisma.TransactionClient,
  publicId: number,
  standingSnapshotId: string,
) {
  const contest = await lockContestFinalizationTx(tx, publicId, 'rating_finalize_complete')
  if (!contest) return false
  const updated = await tx.contest.updateMany({
    where: { id: contest.id, finalizationStatus: 'FINALIZING' },
    data: {
      finalizationStatus: 'FINALIZED',
      finalizedStandingId: standingSnapshotId,
      status: 'finished',
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  if (updated.count === 1) {
    const readers = await tx.contestProblem.findMany({ where: { contestId: contest.id, testSetReaderId: { not: null } }, select: { id: true, testSetReaderId: true } })
    for (const item of readers) {
      if (item.testSetReaderId) await releaseTestSetReaderTx(tx, item.testSetReaderId)
      await tx.contestProblem.update({ where: { id: item.id }, data: { testSetReaderId: null } })
    }
  }
  return updated.count === 1
}

export async function failContestFinalizationTx(
  tx: Prisma.TransactionClient,
  publicId: number,
) {
  const contest = await lockContestFinalizationTx(tx, publicId, 'rating_finalize_failed')
  if (!contest) return false
  const updated = await tx.contest.updateMany({
    where: { id: contest.id, finalizationStatus: { in: ['LIVE', 'JUDGING'] } },
    data: {
      finalizationStatus: 'FAILED',
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  return updated.count === 1
}

export async function completeContestRatingRebuildTx(
  tx: Prisma.TransactionClient,
  publicId: number,
  standingSnapshotId: string,
) {
  const contest = await lockContestFinalizationTx(tx, publicId, 'rating_rebuild_complete')
  if (!contest) return false
  const updated = await tx.contest.updateMany({
    where: { id: contest.id, finalizationStatus: 'HELD' },
    data: {
      finalizedStandingId: standingSnapshotId,
      finalizationStatus: 'FINALIZED',
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  if (updated.count === 1) {
    const readers = await tx.contestProblem.findMany({ where: { contestId: contest.id, testSetReaderId: { not: null } }, select: { id: true, testSetReaderId: true } })
    for (const item of readers) {
      if (item.testSetReaderId) await releaseTestSetReaderTx(tx, item.testSetReaderId)
      await tx.contestProblem.update({ where: { id: item.id }, data: { testSetReaderId: null } })
    }
  }
  return updated.count === 1
}
