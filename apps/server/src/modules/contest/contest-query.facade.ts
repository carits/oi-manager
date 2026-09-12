import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import logger from '../../lib/logger'

const runtimeRatingInclude = {
  RatingConfig: true,
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
    include: { RuntimeTraining: { include: runtimeRatingInclude } },
  })
  if (aggregate?.RuntimeTraining) {
    if (aggregate.RuntimeTraining.type !== 'contest') {
      logger.error('contest_runtime_type_mismatch', new Error('Contest runtime is not a contest'), {
        action: 'contest_query', metadata: { contestId: aggregate.id, runtimeTrainingId },
      })
      return null
    }
    return { contest: aggregate, runtime: aggregate.RuntimeTraining, source: 'aggregate' as const }
  }

  // Read-only compatibility for records not yet backfilled. Production audits
  // require this path to remain at zero before it can be removed.
  const legacy = await prisma.training.findFirst({
    where: { id: runtimeTrainingId, type: 'contest' },
    include: runtimeRatingInclude,
  })
  if (!legacy) return null
  logger.warn('contest_query_legacy_fallback', {
    action: 'contest_query', metadata: { runtimeTrainingId, consumer: 'rating' },
  })
  return { contest: null, runtime: legacy, source: 'legacy' as const }
}

export async function listPlatformContestRuntimes() {
  const aggregates = await prisma.contest.findMany({
    where: { scope: 'platform', teamId: null, organizationId: null, runtimeTrainingId: { not: null } },
    include: {
      RuntimeTraining: {
        include: {
          RatingConfig: { select: { scope: true, track: true, lockedAt: true } },
          _count: { select: { TrainingProblem: true, TrainingParticipant: true } },
        },
      },
    },
  })
  const mappedRuntimeIds = new Set(aggregates.flatMap(row => row.runtimeTrainingId === null ? [] : [row.runtimeTrainingId]))
  const mapped = aggregates.flatMap(row => row.RuntimeTraining?.type === 'contest' ? [row.RuntimeTraining] : [])

  const legacy = await prisma.training.findMany({
    where: {
      type: 'contest', scope: 'platform', teamId: null, organizationId: null,
      ...(mappedRuntimeIds.size ? { id: { notIn: [...mappedRuntimeIds] } } : {}),
    },
    include: {
      RatingConfig: { select: { scope: true, track: true, lockedAt: true } },
      _count: { select: { TrainingProblem: true, TrainingParticipant: true } },
    },
  })
  if (legacy.length) {
    logger.warn('contest_query_legacy_fallback', {
      action: 'contest_query', metadata: {
        consumer: 'platform_list', count: legacy.length,
        runtimeTrainingIds: legacy.slice(0, 20).map(row => row.id),
      },
    })
  }
  return [...mapped, ...legacy]
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
  const legacy = await prisma.training.findFirst({
    where: { id: runtimeTrainingId, type: 'contest' },
    include: licenseRuntimeInclude,
  })
  if (!legacy) return null
  logger.warn('contest_query_legacy_fallback', {
    action: 'contest_query', metadata: { runtimeTrainingId, consumer: 'data_license' },
  })
  return { contest: null, runtime: legacy, source: 'legacy' as const }
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
  const mappedIds = aggregates.flatMap(row => row.runtimeTrainingId === null ? [] : [row.runtimeTrainingId])
  const legacy = await prisma.training.findMany({
    where: {
      type: 'contest', ...scopeFilter,
      ...(mappedIds.length ? { id: { notIn: mappedIds } } : {}),
    },
    select: { id: true },
  })
  if (legacy.length) {
    logger.warn('contest_query_legacy_fallback', {
      action: 'contest_query', metadata: {
        consumer: 'data_license_scope', count: legacy.length,
        runtimeTrainingIds: legacy.slice(0, 20).map(row => row.id),
      },
    })
  }
  return [...mappedIds, ...legacy.map(row => row.id)]
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
  const mappedIds = aggregates.flatMap(row => row.runtimeTrainingId === null ? [] : [row.runtimeTrainingId])
  const mapped = aggregates.flatMap(row => row.RuntimeTraining?.type === 'contest' ? [row.RuntimeTraining] : [])

  const runtimeScopes: Prisma.TrainingWhereInput[] = [
    ...(input.teamIds.length ? [{ teamId: { in: input.teamIds }, scope: input.resourceScope }] : []),
    ...(input.resourceScope === 'campus' && input.organizationId
      ? [{ organizationId: input.organizationId, teamId: null, scope: 'campus' }]
      : []),
    ...(input.resourceScope === 'personal'
      ? [{ teamId: null, organizationId: null, scope: 'platform' }]
      : []),
  ]
  const legacy = await prisma.training.findMany({
    where: {
      type: 'contest', OR: runtimeScopes,
      ...(mappedIds.length ? { id: { notIn: mappedIds } } : {}),
    },
    include: dashboardRuntimeInclude,
  })
  if (legacy.length) {
    logger.warn('contest_query_legacy_fallback', {
      action: 'contest_query', metadata: {
        consumer: 'dashboard', count: legacy.length,
        runtimeTrainingIds: legacy.slice(0, 20).map(row => row.id),
      },
    })
  }
  return [...mapped, ...legacy]
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
    logger.warn('contest_query_legacy_fallback', {
      action: 'contest_query',
      metadata: { runtimeTrainingId, consumer: 'ranking' },
    })
    return { contest: null, runtime, source: 'legacy' as const }
  }
  return { contest: null, runtime, source: 'training' as const }
}
