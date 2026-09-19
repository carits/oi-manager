import { v4 as uuidv4 } from 'uuid'
import { prisma } from '../../../prisma'

async function resolveProblemId(activityId: number, activityProblemId: string) {
  const contest = await prisma.contest.findUnique({
    where: { publicId: activityId },
    select: {
      ContestProblem: {
        where: { id: activityProblemId },
        select: { canonicalProblemId: true },
        take: 1,
      },
    },
  })
  if (contest) return contest.ContestProblem[0]?.canonicalProblemId || null
  const problem = await prisma.trainingProblem.findFirst({
    where: { id: activityProblemId, trainingId: activityId },
    select: { problemId: true },
  })
  return problem?.problemId || null
}

export async function getTrainingProblemNote(
  trainingId: number, trainingProblemId: string, userId: string, userType: string,
) {
  const problemId = await resolveProblemId(trainingId, trainingProblemId)
  if (!problemId) return null
  const note = await prisma.problemNote.findUnique({
    where: { problemId_userId_userType: { problemId, userId, userType } },
  })
  return note || { content: '' }
}

export async function saveTrainingProblemNote(
  trainingId: number, trainingProblemId: string, userId: string, userType: string, content: unknown,
) {
  const problemId = await resolveProblemId(trainingId, trainingProblemId)
  if (!problemId) return null
  return prisma.problemNote.upsert({
    where: { problemId_userId_userType: { problemId, userId, userType } },
    create: {
      id: uuidv4(), problemId, userId, userType,
      content: typeof content === 'string' ? content : '',
    },
    update: { content: typeof content === 'string' ? content : '' },
  })
}

export async function getTrainingRecord(trainingId: number, userId: string, userType: string) {
  const contest = await prisma.contest.findUnique({ where: { publicId: trainingId }, select: { id: true } })
  if (contest) {
    return (await prisma.contestRecord.findUnique({
      where: { canonicalContestId_userId_userType: {
        canonicalContestId: contest.id,
        userId,
        userType,
      } },
    })) || { content: '' }
  }
  return (await prisma.contestRecord.findUnique({
    where: { trainingId_userId_userType: { trainingId, userId, userType } },
  })) || { content: '' }
}

export async function saveTrainingRecord(
  trainingId: number, userId: string, userType: string, content: unknown,
) {
  const contest = await prisma.contest.findUnique({ where: { publicId: trainingId }, select: { id: true } })
  if (contest) {
    return prisma.contestRecord.upsert({
      where: { canonicalContestId_userId_userType: {
        canonicalContestId: contest.id,
        userId,
        userType,
      } },
      create: {
        id: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        trainingId: null,
        canonicalContestId: contest.id,
        userId,
        userType,
        content: typeof content === 'string' ? content : '',
      },
      update: { content: typeof content === 'string' ? content : '' },
    })
  }
  const training = await prisma.training.findFirst({
    where: { id: trainingId, type: { not: 'contest' } },
    select: { id: true },
  })
  if (!training) return null
  return prisma.contestRecord.upsert({
    where: { trainingId_userId_userType: { trainingId, userId, userType } },
    create: {
      id: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      trainingId,
      canonicalContestId: null,
      userId,
      userType,
      content: typeof content === 'string' ? content : '',
    },
    update: { content: typeof content === 'string' ? content : '' },
  })
}
