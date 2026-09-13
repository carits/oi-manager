import { prisma } from '../../../prisma'
import { prepareDemoContestRuntimesTx } from '../../contest/contest-command.service'
import { listCanonicalContestRuntimesForMaintenance } from '../../contest/contest-query.facade'

export function findDemoUsers(usernames: string[]) {
  return prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true, username: true } })
}

export function findDemoTrainings(teamId: string, titlePrefix: string) {
  return listCanonicalContestRuntimesForMaintenance({ teamId, titlePrefix, scope: 'campus' })
}

export function countDemoSubmissions(sourcePrefix: string) {
  return prisma.submission.count({ where: { sourceId: { startsWith: sourcePrefix } } })
}

export function prepareDemoContestRuntimes(ids: number[], startTime: Date, endTime: Date) {
  return prisma.$transaction(tx => prepareDemoContestRuntimesTx(tx, {
    runtimeTrainingIds: ids,
    startTime,
    endTime,
  }))
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
  return listCanonicalContestRuntimesForMaintenance({ runtimeTrainingIds: ids })
}
