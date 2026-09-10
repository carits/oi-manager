import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'

/**
 * Keeps the normalized Contest aggregate in the same transaction as its
 * runtime Training compatibility row. The operation is deliberately
 * idempotent while both read models coexist.
 */
export async function ensureContestAggregateTx(tx: Prisma.TransactionClient, trainingId: number) {
  const training = await tx.training.findUnique({
    where: { id: trainingId },
    include: { RatingConfig: { select: { scope: true } } },
  })
  if (!training || training.type !== 'contest') return null
  const data = {
    organizationId: training.organizationId,
    title: training.title,
    description: training.description,
    contestDate: training.startTime,
    startAt: training.startTime,
    endAt: training.endTime,
    format: training.format,
    status: training.status,
    type: 'judged',
    teamId: training.teamId,
    countRating: Boolean(training.RatingConfig && training.RatingConfig.scope !== 'NONE'),
    scope: training.scope,
    updatedAt: new Date(),
  }
  return tx.contest.upsert({
    where: { runtimeTrainingId: training.id },
    create: { id: crypto.randomUUID(), runtimeTrainingId: training.id, ...data },
    update: data,
  })
}

export async function syncContestProblemAggregateTx(tx: Prisma.TransactionClient, trainingProblemId: string) {
  const runtimeProblem = await tx.trainingProblem.findUnique({
    where: { id: trainingProblemId },
    include: { Training: true, Problem: true },
  })
  if (!runtimeProblem || runtimeProblem.Training.type !== 'contest') return null
  const contest = await ensureContestAggregateTx(tx, runtimeProblem.trainingId)
  if (!contest) return null
  const data = {
    contestId: contest.id,
    canonicalProblemId: runtimeProblem.problemId,
    testSetRevisionId: runtimeProblem.testSetRevisionId,
    orderIndex: runtimeProblem.orderIndex,
    title: runtimeProblem.titleSnapshot || runtimeProblem.Problem.title,
    ojName: runtimeProblem.sourcePlatformSnapshot || runtimeProblem.Problem.platform,
    problemId: runtimeProblem.sourceProblemIdSnapshot || runtimeProblem.Problem.problemId,
    difficulty: runtimeProblem.Problem.difficulty,
    points: runtimeProblem.points,
    statementType: runtimeProblem.statementSnapshot ? 'snapshot' : 'none',
    solutionVisible: runtimeProblem.Training.solutionVisible,
    updatedAt: new Date(),
  }
  return tx.contestProblem.upsert({
    where: { runtimeTrainingProblemId: runtimeProblem.id },
    create: { id: crypto.randomUUID(), runtimeTrainingProblemId: runtimeProblem.id, ...data },
    update: data,
  })
}

export async function deleteContestProblemAggregateTx(tx: Prisma.TransactionClient, trainingProblemId: string) {
  await tx.contestProblem.deleteMany({ where: { runtimeTrainingProblemId: trainingProblemId } })
}

/**
 * Temporary negative ordering is part of Training's two-phase reorder. Keep
 * even this projection-only write behind the aggregate boundary so Training
 * remains the sole mutable source of contest structure.
 */
export async function stageContestProblemOrderProjectionTx(
  tx: Prisma.TransactionClient,
  trainingProblemId: string,
  temporaryOrderIndex: number,
) {
  await tx.contestProblem.updateMany({
    where: { runtimeTrainingProblemId: trainingProblemId },
    data: { orderIndex: temporaryOrderIndex },
  })
}
