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
  return contest?.ContestProblem[0]?.canonicalProblemId || null
}

export async function getContestProblemNote(
  contestId: number, contestProblemId: string, userId: string, userType: string,
) {
  const problemId = await resolveProblemId(contestId, contestProblemId)
  if (!problemId) return null
  const note = await prisma.problemNote.findUnique({
    where: { problemId_userId_userType: { problemId, userId, userType } },
  })
  return note || { content: '' }
}

export async function saveContestProblemNote(
  contestId: number, contestProblemId: string, userId: string, userType: string, content: unknown,
) {
  const problemId = await resolveProblemId(contestId, contestProblemId)
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

export async function getContestRecord(contestId: number, userId: string, userType: string) {
  const contest = await prisma.contest.findUnique({ where: { publicId: contestId }, select: { id: true } })
  if (!contest) return null
  return (await prisma.contestRecord.findUnique({
    where: { canonicalContestId_userId_userType: {
      canonicalContestId: contest.id,
      userId,
      userType,
    } },
  })) || { content: '' }
}

export async function saveContestRecord(
  contestId: number, userId: string, userType: string, content: unknown,
) {
  const contest = await prisma.contest.findUnique({ where: { publicId: contestId }, select: { id: true } })
  if (!contest) return null
  return prisma.contestRecord.upsert({
    where: { canonicalContestId_userId_userType: {
      canonicalContestId: contest.id,
      userId,
      userType,
    } },
    create: {
      id: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      canonicalContestId: contest.id,
      userId,
      userType,
      content: typeof content === 'string' ? content : '',
    },
    update: { content: typeof content === 'string' ? content : '' },
  })
}
