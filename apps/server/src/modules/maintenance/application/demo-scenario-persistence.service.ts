import { prisma } from '../../../prisma'
import { prepareDemoContestsTx } from '../../contest/contest-command.service'
import { listContestsForMaintenance } from '../../contest/contest-query.facade'

export function findDemoUsers(usernames: string[]) {
  return prisma.user.findMany({ where: { username: { in: usernames } }, select: { id: true, username: true } })
}

export function findDemoTrainings(teamId: string, titlePrefix: string) {
  return listContestsForMaintenance({ teamId, titlePrefix, scope: 'campus' })
}

export function countDemoSubmissions(sourcePrefix: string) {
  return prisma.submission.count({ where: { sourceId: { startsWith: sourcePrefix } } })
}

export function prepareDemoContestRuntimes(ids: number[], startTime: Date, endTime: Date) {
  return prisma.$transaction(tx => prepareDemoContestsTx(tx, {
    publicIds: ids,
    startTime,
    endTime,
  }))
}

export function normalizeDemoSubmission(sourceId: string, createdAt: Date) {
  return prisma.submission.updateMany({ where: { sourceId }, data: { createdAt, updatedAt: new Date() } })
}

export async function findDemoContestProblems(contestPublicId: number) {
  const contest = await prisma.contest.findUnique({ where: { publicId: contestPublicId }, select: { id: true } })
  if (!contest) return []
  const rows = await prisma.contestProblem.findMany({
    where: { contestId: contest.id, canonicalProblemId: { not: null } },
    include: {
      CanonicalProblem: {
        select: { id: true, platform: true, problemId: true },
      },
    },
    orderBy: { orderIndex: 'asc' },
  })
  return rows.flatMap(row => row.CanonicalProblem ? [{ ...row, Problem: row.CanonicalProblem }] : [])
}

export async function demoSubmissionExists(sourceId: string) {
  return Boolean(await prisma.submission.findFirst({ where: { sourceId }, select: { id: true } }))
}

export function findDemoTrainingsByIds(ids: number[]) {
  return listContestsForMaintenance({ publicIds: ids })
}
