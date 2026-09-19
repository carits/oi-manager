import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import logger from '../../lib/logger'
import { contestActivityInclude, contestAsActivity } from './contest-activity-projection'

async function findContestByPublicId(publicId: number) {
  return prisma.contest.findUnique({
    where: { publicId },
    include: contestActivityInclude,
  })
}

async function findOrdinaryTraining(publicId: number, include: Prisma.TrainingInclude = {}) {
  const training = await prisma.training.findUnique({ where: { id: publicId }, include })
  if (!training || training.type === 'contest') return null
  return training
}

export async function findContestForRating(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  if (!contest) return null
  return { contest, activity: contestAsActivity(contest), source: 'contest' as const }
}

export async function listPlatformContests() {
  const contests = await prisma.contest.findMany({
    where: { scope: 'platform', teamId: null, organizationId: null },
    include: contestActivityInclude,
  })
  return contests.map(contestAsActivity)
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
    include: contestActivityInclude,
    orderBy: { publicId: 'asc' },
  })
  return contests.map(contestAsActivity)
}

export async function listTeamContests(teamId: string, scope: string) {
  const contests = await prisma.contest.findMany({
    where: { teamId, scope },
    include: contestActivityInclude,
    orderBy: { startAt: 'desc' },
  })
  return contests.map(contestAsActivity)
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
      ...contestActivityInclude,
      Team: { include: { TeamMember: true } },
    },
  })
  if (!contest) return null
  return { contest, activity: contestAsActivity(contest), source: 'contest' as const }
}

export async function listContestPublicIdsForLicenseScopes(input: {
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
    select: { publicId: true },
  })
  return rows.map(row => row.publicId)
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
    include: contestActivityInclude,
  })
  return contests.map(contestAsActivity)
}

export async function findActivityForRanking(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  if (contest) return { contest, activity: contestAsActivity(contest), source: 'contest' as const }
  const activity = await findOrdinaryTraining(publicId, {
    TrainingProblem: {
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true, problemId: true, alias: true, points: true, orderIndex: true,
        Problem: { select: { problemId: true } },
      },
    },
  })
  return activity ? { contest: null, activity, source: 'training' as const } : null
}

export async function findContestForBlogReview(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  if (!contest) return null
  return { contest, activity: contestAsActivity(contest), source: 'contest' as const }
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

export async function findCanonicalContestSubmissionIdentity(
  publicId: number,
  contestProblemId: string,
) {
  const contest = await prisma.contest.findUnique({
    where: { publicId },
    select: {
      id: true,
      ContestProblem: {
        where: { id: contestProblemId },
        select: { id: true },
        take: 1,
      },
    },
  })
  const problem = contest?.ContestProblem[0]
  if (!contest || !problem) {
    logger.error('contest_submission_identity_missing', new Error('Contest submission identity is not mapped'), {
      action: 'contest_query',
      metadata: { publicId, contestProblemId },
    })
    return null
  }
  return { canonicalContestId: contest.id, canonicalContestProblemId: problem.id }
}

export async function findActivityForSubmission(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  if (contest) return { contest, activity: contestAsActivity(contest), source: 'contest' as const }
  const activity = await findOrdinaryTraining(publicId)
  return activity ? { contest: null, activity, source: 'training' as const } : null
}

export async function findActivityForAccess(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  if (contest) return { contest, activity: contestAsActivity(contest), source: 'contest' as const }
  const activity = await findOrdinaryTraining(publicId, {
    Team: { select: { organizationId: true, scope: true } },
  })
  return activity ? { contest: null, activity, source: 'training' as const } : null
}

export async function findActivityForDetail(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  if (contest) return contestAsActivity(contest)
  const activity = await findOrdinaryTraining(publicId, {
    _count: { select: { TrainingParticipant: true, TrainingProblem: true } },
  })
  return activity ? { ...activity, RatingConfig: null } : null
}

export async function findActivityForOverview(publicId: number) {
  const contest = await findContestByPublicId(publicId)
  if (contest) return { contest, activity: contestAsActivity(contest), source: 'contest' as const }
  const activity = await findOrdinaryTraining(publicId, {
    _count: { select: { TrainingParticipant: true, TrainingProblem: true } },
    TrainingProblem: {
      include: {
        Problem: {
          select: {
            id: true, title: true, platform: true, problemId: true, difficulty: true,
            timeLimit: true, memoryLimit: true,
            _count: { select: { ProblemAttachment: true } },
          },
        },
        TrainingSolution: { select: { id: true, visible: true } },
        _count: { select: { TrainingAttachment: true } },
      },
      orderBy: { orderIndex: 'asc' },
    },
  })
  return activity ? { contest: null, activity, source: 'training' as const } : null
}
