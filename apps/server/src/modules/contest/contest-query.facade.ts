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
