import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { contestInclude, toContestView } from './contest-view'

async function findContestByPublicId(publicId: number) {
  return prisma.contest.findUnique({
    where: { publicId },
    include: contestInclude,
  })
}

export async function findContestForRating(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  if (!contest) return null
  return { canonical: contest, contest: toContestView(contest), source: 'contest' as const }
}

export async function listPlatformContests() {
  const contests = await prisma.contest.findMany({
    where: { scope: 'platform', teamId: null, organizationId: null },
    include: contestInclude,
  })
  return contests.map(toContestView)
}

export async function listContestsForMaintenance(input: {
  publicIds?: number[]
  teamId?: string
  titlePrefix?: string
  scope?: string
}) {
  if (input.publicIds && input.publicIds.length === 0) return []
  const contests = await prisma.contest.findMany({
    where: {
      ...(input.publicIds && { publicId: { in: input.publicIds } }),
      ...(input.teamId !== undefined && { teamId: input.teamId }),
      ...(input.titlePrefix !== undefined && { title: { startsWith: input.titlePrefix } }),
      ...(input.scope !== undefined && { scope: input.scope }),
    },
    include: contestInclude,
    orderBy: { publicId: 'asc' },
  })
  return contests.map(toContestView)
}

export async function listTeamContests(teamId: string, scope: string) {
  const contests = await prisma.contest.findMany({
    where: { teamId, scope },
    include: contestInclude,
    orderBy: { startAt: 'desc' },
  })
  return contests.map(toContestView)
}

export async function listFinishedContestPublicIds() {
  const rows = await prisma.contest.findMany({
    where: { status: 'finished' },
    select: { publicId: true },
  })
  return rows.map(row => row.publicId)
}

export async function listFinishedContestIds() {
  const rows = await prisma.contest.findMany({
    where: { status: 'finished' },
    select: { id: true },
  })
  return rows.map(row => row.id)
}

export async function findContestForLicense(publicId: number) {
  const contest = await prisma.contest.findUnique({
    where: { publicId },
    include: {
      ...contestInclude,
      Team: { include: { TeamMember: true } },
    },
  })
  if (!contest) return null
  return { canonical: contest, contest: toContestView(contest), source: 'contest' as const }
}

export async function listContestIdsForLicenseScopes(input: {
  organizationIds: string[]
  teamIds: string[]
}) {
  if (!input.organizationIds.length && !input.teamIds.length) return []
  const rows = await prisma.contest.findMany({
    where: {
      OR: [
        ...(input.teamIds.length ? [{ teamId: { in: input.teamIds } }] : []),
        ...(input.organizationIds.length ? [{ organizationId: { in: input.organizationIds } }] : []),
      ],
    },
    select: { id: true },
  })
  return rows.map(row => row.id)
}

export async function listContestsForDashboard(input: {
  teamIds: string[]
  resourceScope: 'campus' | 'personal'
  organizationId?: string | null
}) {
  const scopes: Prisma.ContestWhereInput[] = [
    ...(input.teamIds.length ? [{ teamId: { in: input.teamIds }, scope: input.resourceScope }] : []),
    ...(input.resourceScope === 'campus' && input.organizationId
      ? [{ organizationId: input.organizationId, teamId: null, scope: 'campus' }]
      : []),
    ...(input.resourceScope === 'personal'
      ? [{ teamId: null, organizationId: null, scope: 'platform' }]
      : []),
  ]
  if (!scopes.length) return []
  const contests = await prisma.contest.findMany({
    where: { OR: scopes },
    include: contestInclude,
  })
  return contests.map(toContestView)
}

export async function findContestForRanking(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  return contest ? { canonical: contest, contest: toContestView(contest), source: 'contest' as const } : null
}

export async function findContestForBlogReview(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  if (!contest) return null
  return { canonical: contest, contest: toContestView(contest), source: 'contest' as const }
}

export async function listDueRatedContests(now = new Date(), limit = 20) {
  const rows = await prisma.contest.findMany({
    where: {
      endAt: { lte: now },
      finalizationStatus: { in: ['LIVE', 'JUDGING'] },
      RatingConfig: { isNot: null },
    },
    select: { publicId: true, createdBy: true, endAt: true },
    orderBy: [{ endAt: 'asc' }, { publicId: 'asc' }],
    take: Math.max(1, Math.min(100, Math.trunc(limit))),
  })
  return rows.flatMap(row => !row.endAt ? [] : [{
    id: row.publicId,
    createdBy: row.createdBy || '',
    endTime: row.endAt,
  }])
}

export async function findContestForSubmission(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  return contest ? { canonical: contest, contest: toContestView(contest), source: 'contest' as const } : null
}

export async function findContestForAccess(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  return contest ? { canonical: contest, contest: toContestView(contest), source: 'contest' as const } : null
}

export async function findContestForDetail(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  return contest ? toContestView(contest) : null
}

export async function findContestForOverview(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  return contest ? { canonical: contest, contest: toContestView(contest), source: 'contest' as const } : null
}
