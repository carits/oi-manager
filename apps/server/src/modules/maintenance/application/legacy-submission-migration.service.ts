import crypto from 'crypto'
import { prisma } from '../../../prisma'

export async function migrateLegacySubmissionScopes() {
  const submissions = await prisma.submission.findMany({
    where: { OR: [{ submitSource: 'training' }, { sourceId: { startsWith: 'training-' } }] },
    select: { id: true, sourceId: true, trainingId: true, submitScope: true },
  })
  const candidates = submissions.filter(item => !item.submitScope || item.submitScope === 'problem')
  if (!candidates.length) return { migrated: 0, contestCount: 0, trainingCount: 0 }
  const trainingIds = new Set<number>()
  for (const item of candidates) {
    const parsed = item.sourceId?.match(/^training-(\d+)$/)
    const trainingId = item.trainingId || (parsed ? Number(parsed[1]) : null)
    if (trainingId) trainingIds.add(trainingId)
  }
  const trainings = await prisma.training.findMany({
    where: { id: { in: [...trainingIds] } }, select: { id: true, type: true },
  })
  const types = new Map(trainings.map(item => [item.id, item.type]))
  let migrated = 0
  let contestCount = 0
  let trainingCount = 0
  for (const item of candidates) {
    const parsed = item.sourceId?.match(/^training-(\d+)$/)
    const trainingId = item.trainingId || (parsed ? Number(parsed[1]) : null)
    if (!trainingId) continue
    const contest = types.get(trainingId) === 'contest'
    const changed = await prisma.submission.updateMany({
      where: { id: item.id, submitScope: 'problem' },
      data: {
        submitScope: contest ? 'contest' : 'training', trainingId,
        contestId: contest ? trainingId : null, isGlobalVisible: false,
      },
    })
    if (!changed.count) continue
    migrated += 1
    if (contest) contestCount += 1
    else trainingCount += 1
  }
  return { migrated, contestCount, trainingCount }
}

export async function migrateLegacyProblemStatuses() {
  const submissions = await prisma.submission.findMany({
    where: {
      submitScope: { in: ['training', 'contest'] },
      result: { in: ['accepted', 'Accepted', 'AC'] },
      trainingId: { not: null },
    },
    select: {
      userId: true, trainingId: true, trainingProblemId: true, contestId: true,
      contestProblemId: true, submitScope: true, result: true, score: true, createdAt: true,
    },
  })
  let trainingStatusCreated = 0
  let contestStatusCreated = 0
  for (const item of submissions) {
    if (item.submitScope === 'training' && item.trainingId && item.trainingProblemId) {
      await prisma.trainingUserProblemStatus.upsert({
        where: { trainingId_userId_trainingProblemId: { trainingId: item.trainingId, userId: item.userId, trainingProblemId: item.trainingProblemId } },
        create: {
          id: crypto.randomUUID(), trainingId: item.trainingId, userId: item.userId,
          trainingProblemId: item.trainingProblemId, bestScore: item.score, bestResult: item.result,
          attemptCount: 1, acAt: item.createdAt,
        },
        update: { bestResult: item.result, acAt: item.createdAt, ...(item.score != null ? { bestScore: item.score } : {}) },
      })
      trainingStatusCreated += 1
    } else if (item.submitScope === 'contest' && item.contestId && item.contestProblemId) {
      await prisma.contestUserProblemStatus.upsert({
        where: { contestId_userId_contestProblemId: { contestId: item.contestId, userId: item.userId, contestProblemId: item.contestProblemId } },
        create: {
          id: crypto.randomUUID(), contestId: item.contestId, userId: item.userId,
          contestProblemId: item.contestProblemId, bestScore: item.score, bestResult: item.result,
          attemptCount: 1, acAt: item.createdAt,
        },
        update: { bestResult: item.result, acAt: item.createdAt, ...(item.score != null ? { bestScore: item.score } : {}) },
      })
      contestStatusCreated += 1
    }
  }
  return { trainingStatusCreated, contestStatusCreated }
}
