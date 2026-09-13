import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'

/**
 * Creates or repairs the canonical Contest aggregate from a legacy runtime.
 * Normal contest commands must mutate Contest first and project back to
 * Training; this reverse bridge is limited to creation, migration and repair.
 */
export async function ensureContestAggregateTx(tx: Prisma.TransactionClient, trainingId: number) {
  const training = await tx.training.findUnique({
    where: { id: trainingId },
  })
  if (!training || training.type !== 'contest') return null
  const data = {
    createdBy: training.createdBy,
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
    scope: training.scope,
    problemIdVisible: training.problemIdVisible,
    solutionVisible: training.solutionVisible,
    includeAdminInRanking: training.includeAdminInRanking,
    finalizationStatus: training.finalizationStatus,
    finalizedStandingId: training.finalizedStandingId,
    updatedAt: new Date(),
  }
  const contest = await tx.contest.upsert({
    where: { runtimeTrainingId: training.id },
    create: { id: crypto.randomUUID(), runtimeTrainingId: training.id, countRating: false, ...data },
    update: data,
  })
  return contest
}

/**
 * Mirrors canonical contest state to the temporary Training compatibility
 * runtime. Callers must already hold the contest transaction lock.
 */
export async function projectContestRuntimeTx(tx: Prisma.TransactionClient, contestId: string) {
  const contest = await tx.contest.findUnique({ where: { id: contestId } })
  if (!contest?.runtimeTrainingId) return null
  return tx.training.update({
    where: { id: contest.runtimeTrainingId },
    data: {
      title: contest.title,
      description: contest.description,
      format: contest.format || 'ioi',
      startTime: contest.startAt || contest.contestDate,
      endTime: contest.endAt || contest.contestDate,
      status: contest.status,
      scope: contest.scope,
      teamId: contest.teamId,
      organizationId: contest.organizationId,
      problemIdVisible: contest.problemIdVisible,
      solutionVisible: contest.solutionVisible,
      includeAdminInRanking: contest.includeAdminInRanking,
      finalizationStatus: contest.finalizationStatus,
      finalizedStandingId: contest.finalizedStandingId,
      updatedAt: new Date(),
    },
  })
}

export async function syncContestProblemAggregateTx(tx: Prisma.TransactionClient, trainingProblemId: string) {
  const runtimeProblem = await tx.trainingProblem.findUnique({
    where: { id: trainingProblemId },
    include: { Training: true, Problem: true },
  })
  if (!runtimeProblem || runtimeProblem.Training.type !== 'contest') return null
  const contest = await tx.contest.findUnique({
    where: { runtimeTrainingId: runtimeProblem.trainingId },
  })
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
 * even this projection-only write behind the aggregate boundary so Contest
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
