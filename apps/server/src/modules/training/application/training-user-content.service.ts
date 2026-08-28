import { v4 as uuidv4 } from 'uuid'
import { prisma } from '../../../prisma'

export async function getTrainingProblemNote(
  trainingId: number, trainingProblemId: string, userId: string, userType: string,
) {
  const problem = await prisma.trainingProblem.findFirst({
    where: { id: trainingProblemId, trainingId }, select: { problemId: true },
  })
  if (!problem) return null
  const note = await prisma.problemNote.findUnique({
    where: { problemId_userId_userType: { problemId: problem.problemId, userId, userType } },
  })
  return note || { content: '' }
}

export async function saveTrainingProblemNote(
  trainingId: number, trainingProblemId: string, userId: string, userType: string, content: unknown,
) {
  const problem = await prisma.trainingProblem.findFirst({
    where: { id: trainingProblemId, trainingId }, select: { problemId: true },
  })
  if (!problem) return null
  return prisma.problemNote.upsert({
    where: { problemId_userId_userType: { problemId: problem.problemId, userId, userType } },
    create: {
      id: uuidv4(), problemId: problem.problemId, userId, userType,
      content: typeof content === 'string' ? content : '',
    },
    update: { content: typeof content === 'string' ? content : '' },
  })
}

export async function getTrainingRecord(trainingId: number, userId: string, userType: string) {
  return (await prisma.contestRecord.findUnique({
    where: { trainingId_userId_userType: { trainingId, userId, userType } },
  })) || { content: '' }
}

export function saveTrainingRecord(
  trainingId: number, userId: string, userType: string, content: unknown,
) {
  return prisma.contestRecord.upsert({
    where: { trainingId_userId_userType: { trainingId, userId, userType } },
    create: {
      id: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      trainingId, userId, userType, content: typeof content === 'string' ? content : '',
    },
    update: { content: typeof content === 'string' ? content : '' },
  })
}
