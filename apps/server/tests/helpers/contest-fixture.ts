import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'

export async function ensureCanonicalContestFixtureTx(tx: Prisma.TransactionClient, trainingId: number) {
  const training = await tx.training.findUnique({ where: { id: trainingId } })
  if (!training || training.type !== 'contest') return null
  const contest = await tx.contest.upsert({
    where: { publicId: training.id },
    create: {
      id: crypto.randomUUID(), publicId: training.id, createdBy: training.createdBy,
      organizationId: training.organizationId, title: training.title,
      description: training.description, contestDate: training.startTime,
      startAt: training.startTime, endAt: training.endTime, format: training.format,
      status: training.status, type: 'judged', teamId: training.teamId,
      scope: training.scope, problemIdVisible: training.problemIdVisible,
      solutionVisible: training.solutionVisible,
      includeAdminInRanking: training.includeAdminInRanking,
      finalizationStatus: training.finalizationStatus,
      finalizedStandingId: training.finalizedStandingId,
    },
    update: {},
  })
  await tx.$queryRaw`
    SELECT setval(
      pg_get_serial_sequence('"Contest"', 'publicId'),
      GREATEST((SELECT COALESCE(MAX("publicId"), 0) + 1 FROM "Contest"), 1),
      false
    )
  `
  return contest
}

export async function syncCanonicalContestProblemFixtureTx(tx: Prisma.TransactionClient, trainingProblemId: string) {
  const source = await tx.trainingProblem.findUnique({
    where: { id: trainingProblemId },
    include: { Training: true, Problem: true },
  })
  if (!source || source.Training.type !== 'contest') return null
  const contest = await tx.contest.findUnique({ where: { publicId: source.trainingId } })
  if (!contest) return null
  const data = {
    contestId: contest.id, canonicalProblemId: source.problemId,
    testSetRevisionId: source.testSetRevisionId, orderIndex: source.orderIndex,
    alias: source.alias, title: source.titleSnapshot || source.Problem.title,
    ojName: source.sourcePlatformSnapshot || source.Problem.platform,
    problemId: source.sourceProblemIdSnapshot || source.Problem.problemId,
    difficulty: source.Problem.difficulty, points: source.points,
    statementType: source.statementSnapshot ? 'snapshot' : 'none',
    statementMarkdown: source.statementSnapshot,
    solutionVisible: source.Training.solutionVisible,
  }
  return tx.contestProblem.upsert({
    where: { id: source.id },
    create: { id: source.id, ...data },
    update: data,
  })
}
