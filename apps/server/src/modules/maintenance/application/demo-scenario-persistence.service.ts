import { prisma } from '../../../prisma'

export function findDemoUsers(usernames: string[]) {
  return prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true, username: true } })
}

export function findDemoTrainings(teamId: string, titlePrefix: string) {
  return prisma.training.findMany({ where: { teamId, title: { startsWith: titlePrefix }, type: 'contest', scope: 'campus' } })
}

export function countDemoSubmissions(sourcePrefix: string) {
  return prisma.submission.count({ where: { sourceId: { startsWith: sourcePrefix } } })
}

export function updateDemoTrainings(ids: number[], data: any) {
  return prisma.training.updateMany({ where: { id: { in: ids } }, data })
}

export function normalizeDemoSubmission(sourceId: string, createdAt: Date) {
  return prisma.submission.updateMany({ where: { sourceId }, data: { createdAt, updatedAt: new Date() } })
}

export function findDemoTrainingProblems(trainingId: number) {
  return prisma.trainingProblem.findMany({
    where: { trainingId },
    include: { Problem: { select: { id: true, platform: true, problemId: true } } },
    orderBy: { orderIndex: 'asc' },
  })
}

export async function demoSubmissionExists(sourceId: string) {
  return Boolean(await prisma.submission.findFirst({ where: { sourceId }, select: { id: true } }))
}

export function findDemoTrainingsByIds(ids: number[]) {
  return prisma.training.findMany({ where: { id: { in: ids } } })
}
