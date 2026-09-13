import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import logger from '../../lib/logger'

const runtimeRatingInclude = {
  Team: { select: { organizationId: true } },
} as const

/**
 * Canonical read boundary while Contest still delegates execution to Training.
 * New contest consumers must enter through this facade instead of interpreting
 * `Training.type = contest` themselves.
 */
export async function findContestRuntimeForRating(runtimeTrainingId: number) {
  const aggregate = await prisma.contest.findUnique({
    where: { runtimeTrainingId },
    include: {
      RatingConfig: true,
      RuntimeTraining: { include: runtimeRatingInclude },
    },
  })
  if (aggregate?.RuntimeTraining) {
    if (aggregate.RuntimeTraining.type !== 'contest') {
      logger.error('contest_runtime_type_mismatch', new Error('Contest runtime is not a contest'), {
        action: 'contest_query', metadata: { contestId: aggregate.id, runtimeTrainingId },
      })
      return null
    }
    return {
      contest: aggregate,
      runtime: {
        ...aggregate.RuntimeTraining,
        RatingConfig: aggregate.RatingConfig,
      },
      source: 'aggregate' as const,
    }
  }
  return null
}

export async function listPlatformContestRuntimes() {
  const aggregates = await prisma.contest.findMany({
    where: { scope: 'platform', teamId: null, organizationId: null, runtimeTrainingId: { not: null } },
    include: {
      RatingConfig: { select: { scope: true, track: true, lockedAt: true } },
      RuntimeTraining: {
        include: {
          _count: { select: { TrainingProblem: true, TrainingParticipant: true } },
        },
      },
    },
  })
  return aggregates.flatMap(row => row.RuntimeTraining?.type === 'contest'
    ? [{ ...row.RuntimeTraining, RatingConfig: row.RatingConfig }]
    : [])
}

/**
 * Resolve disposable demo fixtures through the canonical Contest identity.
 * Maintenance code must not rediscover contests by querying
 * `Training.type = contest` directly.
 */
export async function listCanonicalContestRuntimesForMaintenance(input: {
  runtimeTrainingIds?: number[]
  teamId?: string
  titlePrefix?: string
  scope?: string
}) {
  if (input.runtimeTrainingIds && input.runtimeTrainingIds.length === 0) return []
  const aggregates = await prisma.contest.findMany({
    where: {
      runtimeTrainingId: input.runtimeTrainingIds ? { in: input.runtimeTrainingIds } : { not: null },
      ...(input.teamId !== undefined && { teamId: input.teamId }),
      ...(input.titlePrefix !== undefined && { title: { startsWith: input.titlePrefix } }),
      ...(input.scope !== undefined && { scope: input.scope }),
    },
    include: { RuntimeTraining: true },
    orderBy: { runtimeTrainingId: 'asc' },
  })
  return aggregates.flatMap(row => row.RuntimeTraining?.type === 'contest' ? [row.RuntimeTraining] : [])
}

/** Canonical finished-contest identities for administrative visibility repair. */
export async function listFinishedContestRuntimeIds() {
  const rows = await prisma.contest.findMany({
    where: {
      status: 'finished',
      runtimeTrainingId: { not: null },
      RuntimeTraining: { is: { type: 'contest' } },
    },
    select: { runtimeTrainingId: true },
  })
  return rows.flatMap(row => row.runtimeTrainingId === null ? [] : [row.runtimeTrainingId])
}

/** Canonical ids for consumers that persist or query Contest-owned facts. */
export async function listFinishedContestIds() {
  const rows = await prisma.contest.findMany({
    where: {
      status: 'finished',
      RuntimeTraining: { is: { type: 'contest' } },
    },
    select: { id: true },
  })
  return rows.map(row => row.id)
}

const licenseRuntimeInclude = {
  Team: { include: { TeamMember: true } },
} as const

/** Resolve the legacy numeric contest route identity through the aggregate. */
export async function findContestRuntimeForLicense(runtimeTrainingId: number) {
  const aggregate = await prisma.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { include: licenseRuntimeInclude } },
  })
  if (aggregate?.RuntimeTraining?.type === 'contest') {
    return { contest: aggregate, runtime: aggregate.RuntimeTraining, source: 'aggregate' as const }
  }
  return null
}

/** Contest license visibility remains keyed by the public runtime id during cutover. */
export async function listContestRuntimeIdsForLicenseScopes(input: {
  organizationIds: string[]
  teamIds: string[]
}) {
  if (!input.organizationIds.length && !input.teamIds.length) return []
  const scopeFilter = {
    OR: [
      ...(input.teamIds.length ? [{ teamId: { in: input.teamIds } }] : []),
      ...(input.organizationIds.length ? [{ organizationId: { in: input.organizationIds } }] : []),
    ],
  }
  const aggregates = await prisma.contest.findMany({
    where: { runtimeTrainingId: { not: null }, ...scopeFilter },
    select: { runtimeTrainingId: true },
  })
  return aggregates.flatMap(row => row.runtimeTrainingId === null ? [] : [row.runtimeTrainingId])
}

const dashboardRuntimeInclude = {
  _count: { select: { TrainingProblem: true } },
} as const

/**
 * Resolve the contest cards visible in one dashboard context. The dashboard
 * still returns the public runtime id while the aggregate becomes the only
 * place allowed to discover contest runtimes.
 */
export async function listContestRuntimesForDashboard(input: {
  teamIds: string[]
  resourceScope: 'campus' | 'personal'
  organizationId?: string | null
}) {
  const aggregateScopes: Prisma.ContestWhereInput[] = [
    ...(input.teamIds.length ? [{ teamId: { in: input.teamIds }, scope: input.resourceScope }] : []),
    ...(input.resourceScope === 'campus' && input.organizationId
      ? [{ organizationId: input.organizationId, teamId: null, scope: 'campus' }]
      : []),
    ...(input.resourceScope === 'personal'
      ? [{ teamId: null, organizationId: null, scope: 'platform' }]
      : []),
  ]
  if (!aggregateScopes.length) return []

  const aggregates = await prisma.contest.findMany({
    where: { runtimeTrainingId: { not: null }, OR: aggregateScopes },
    include: { RuntimeTraining: { include: dashboardRuntimeInclude } },
  })
  return aggregates.flatMap(row => row.RuntimeTraining?.type === 'contest' ? [row.RuntimeTraining] : [])
}

const rankingRuntimeInclude = {
  TrainingProblem: {
    orderBy: { orderIndex: 'asc' as const },
    select: {
      id: true,
      problemId: true,
      alias: true,
      points: true,
      orderIndex: true,
      Problem: { select: { problemId: true } },
    },
  },
} as const

/**
 * Ranking is shared by training and contest routes. Contest runtimes resolve
 * through the aggregate first; ordinary training records remain direct.
 */
export async function findActivityRuntimeForRanking(runtimeTrainingId: number) {
  const aggregate = await prisma.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { include: rankingRuntimeInclude } },
  })
  if (aggregate?.RuntimeTraining) {
    if (aggregate.RuntimeTraining.type !== 'contest') {
      logger.error('contest_runtime_type_mismatch', new Error('Contest runtime is not a contest'), {
        action: 'contest_query',
        metadata: { contestId: aggregate.id, runtimeTrainingId, consumer: 'ranking' },
      })
      return null
    }
    return { contest: aggregate, runtime: aggregate.RuntimeTraining, source: 'aggregate' as const }
  }

  const runtime = await prisma.training.findUnique({
    where: { id: runtimeTrainingId },
    include: rankingRuntimeInclude,
  })
  if (!runtime) return null
  if (runtime.type === 'contest') {
    logger.error('contest_aggregate_missing', new Error('Contest runtime has no canonical aggregate'), {
      action: 'contest_query',
      metadata: { runtimeTrainingId, consumer: 'ranking' },
    })
    return null
  }
  return { contest: null, runtime, source: 'training' as const }
}

const blogReviewRuntimeSelect = {
  id: true,
  title: true,
  finalizedStandingId: true,
  status: true,
} as const

/** Resolve the public runtime route identity before creating a contest review. */
export async function findContestRuntimeForBlogReview(runtimeTrainingId: number) {
  const aggregate = await prisma.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { select: blogReviewRuntimeSelect } },
  })
  if (aggregate?.RuntimeTraining) {
    return {
      contest: aggregate,
      runtime: {
        ...aggregate.RuntimeTraining,
        status: aggregate.status,
        finalizedStandingId: aggregate.finalizedStandingId,
      },
      source: 'aggregate' as const,
    }
  }
  return null
}

/**
 * Discover due Rating work from canonical Contest lifecycle state. Training
 * is consulted only for execution ownership and a creator fallback during the
 * compatibility window. Rating eligibility is read from canonical Contest.
 */
export async function listDueRatedContestRuntimes(now = new Date(), limit = 20) {
  const rows = await prisma.contest.findMany({
    where: {
      runtimeTrainingId: { not: null },
      endAt: { lte: now },
      finalizationStatus: { in: ['LIVE', 'JUDGING'] },
      RatingConfig: { isNot: null },
      RuntimeTraining: { is: { type: 'contest' } },
    },
    select: {
      runtimeTrainingId: true,
      createdBy: true,
      endAt: true,
      RuntimeTraining: { select: { createdBy: true } },
    },
    orderBy: [{ endAt: 'asc' }, { runtimeTrainingId: 'asc' }],
    take: Math.max(1, Math.min(100, Math.trunc(limit))),
  })
  return rows.flatMap(row => row.runtimeTrainingId === null || !row.endAt || !row.RuntimeTraining
    ? []
    : [{
        id: row.runtimeTrainingId,
        createdBy: row.createdBy || row.RuntimeTraining.createdBy,
        endTime: row.endAt,
      }])
}

const submissionContextRuntimeSelect = {
  id: true,
  teamId: true,
  organizationId: true,
  createdBy: true,
  format: true,
  type: true,
  status: true,
  startTime: true,
  endTime: true,
  problemIdVisible: true,
  scope: true,
} as const

/**
 * Resolve the immutable aggregate/problem identity stored on a new contest
 * submission. Numeric ids remain in the payload only for route compatibility.
 */
export async function findCanonicalContestSubmissionIdentity(
  runtimeTrainingId: number,
  runtimeTrainingProblemId: string,
) {
  const contest = await prisma.contest.findUnique({
    where: { runtimeTrainingId },
    select: {
      id: true,
      ContestProblem: {
        where: { runtimeTrainingProblemId },
        select: { id: true },
        take: 1,
      },
    },
  })
  const problem = contest?.ContestProblem[0]
  if (!contest || !problem) {
    logger.error('contest_submission_identity_missing', new Error('Contest submission identity is not mapped'), {
      action: 'contest_query',
      metadata: { runtimeTrainingId, runtimeTrainingProblemId },
    })
    return null
  }
  return { canonicalContestId: contest.id, canonicalContestProblemId: problem.id }
}

/**
 * Submission detail is shared by training and contest routes. Resolve mapped
 * contests through the aggregate while leaving ordinary training untouched.
 */
export async function findActivityRuntimeForSubmission(runtimeTrainingId: number) {
  const aggregate = await prisma.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { select: submissionContextRuntimeSelect } },
  })
  if (aggregate?.RuntimeTraining) {
    if (aggregate.RuntimeTraining.type !== 'contest') {
      logger.error('contest_runtime_type_mismatch', new Error('Contest runtime is not a contest'), {
        action: 'contest_query',
        metadata: { contestId: aggregate.id, runtimeTrainingId, consumer: 'submission_detail' },
      })
      return null
    }
    return { contest: aggregate, runtime: aggregate.RuntimeTraining, source: 'aggregate' as const }
  }
  const runtime = await prisma.training.findUnique({
    where: { id: runtimeTrainingId },
    select: submissionContextRuntimeSelect,
  })
  if (!runtime) return null
  if (runtime.type === 'contest') {
    logger.error('contest_aggregate_missing', new Error('Contest runtime has no canonical aggregate'), {
      action: 'contest_query', metadata: { runtimeTrainingId, consumer: 'submission_detail' },
    })
    return null
  }
  return { contest: null, runtime, source: 'training' as const }
}

/** Resolve the shared access checks used by activity resources and solutions. */
export async function findActivityRuntimeForAccess(runtimeTrainingId: number) {
  const aggregate = await prisma.contest.findUnique({
    where: { runtimeTrainingId },
    include: {
      RuntimeTraining: { include: { Team: { select: { organizationId: true, scope: true } } } },
    },
  })
  if (aggregate?.RuntimeTraining) {
    if (aggregate.RuntimeTraining.type !== 'contest') {
      logger.error('contest_runtime_type_mismatch', new Error('Contest runtime is not a contest'), {
        action: 'contest_query',
        metadata: { contestId: aggregate.id, runtimeTrainingId, consumer: 'activity_access' },
      })
      return null
    }
    return { contest: aggregate, runtime: aggregate.RuntimeTraining, source: 'aggregate' as const }
  }
  const runtime = await prisma.training.findUnique({
    where: { id: runtimeTrainingId },
    include: { Team: { select: { organizationId: true, scope: true } } },
  })
  if (!runtime) return null
  if (runtime.type === 'contest') {
    logger.error('contest_aggregate_missing', new Error('Contest runtime has no canonical aggregate'), {
      action: 'contest_query', metadata: { runtimeTrainingId, consumer: 'activity_access' },
    })
    return null
  }
  return { contest: null, runtime, source: 'training' as const }
}

const detailRuntimeInclude = {
  _count: { select: { TrainingParticipant: true, TrainingProblem: true } },
} as const

/** Resolve activity detail and attach Contest-owned Rating configuration. */
export async function findActivityRuntimeForDetail(runtimeTrainingId: number) {
  const aggregate = await prisma.contest.findUnique({
    where: { runtimeTrainingId },
    include: {
      RatingConfig: true,
      RuntimeTraining: { include: detailRuntimeInclude },
    },
  })
  if (aggregate?.RuntimeTraining) {
    if (aggregate.RuntimeTraining.type !== 'contest') {
      logger.error('contest_runtime_type_mismatch', new Error('Contest runtime is not a contest'), {
        action: 'contest_query',
        metadata: { contestId: aggregate.id, runtimeTrainingId, consumer: 'activity_detail' },
      })
      return null
    }
    return { ...aggregate.RuntimeTraining, RatingConfig: aggregate.RatingConfig }
  }
  const runtime = await prisma.training.findUnique({
    where: { id: runtimeTrainingId },
    include: detailRuntimeInclude,
  })
  if (!runtime) return null
  if (runtime.type === 'contest') {
    logger.error('contest_aggregate_missing', new Error('Contest runtime has no canonical aggregate'), {
      action: 'contest_query', metadata: { runtimeTrainingId, consumer: 'activity_detail' },
    })
    return null
  }
  return { ...runtime, RatingConfig: null }
}

const overviewRuntimeInclude = {
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
    orderBy: { orderIndex: 'asc' as const },
  },
} as const

/** Resolve the participant-facing activity overview through Contest first. */
export async function findActivityRuntimeForOverview(runtimeTrainingId: number) {
  const aggregate = await prisma.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { include: overviewRuntimeInclude } },
  })
  if (aggregate?.RuntimeTraining) {
    if (aggregate.RuntimeTraining.type !== 'contest') {
      logger.error('contest_runtime_type_mismatch', new Error('Contest runtime is not a contest'), {
        action: 'contest_query',
        metadata: { contestId: aggregate.id, runtimeTrainingId, consumer: 'activity_overview' },
      })
      return null
    }
    return { contest: aggregate, runtime: aggregate.RuntimeTraining, source: 'aggregate' as const }
  }
  const runtime = await prisma.training.findUnique({
    where: { id: runtimeTrainingId },
    include: overviewRuntimeInclude,
  })
  if (!runtime) return null
  if (runtime.type === 'contest') {
    logger.error('contest_aggregate_missing', new Error('Contest runtime has no canonical aggregate'), {
      action: 'contest_query', metadata: { runtimeTrainingId, consumer: 'activity_overview' },
    })
    return null
  }
  return { contest: null, runtime, source: 'training' as const }
}
