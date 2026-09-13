import type { Prisma } from '@prisma/client'
import crypto from 'node:crypto'
import logger from '../../lib/logger'
import {
  deleteContestProblemAggregateTx,
  ensureContestAggregateTx,
  projectContestRuntimeTx,
  stageContestProblemOrderProjectionTx,
  syncContestProblemAggregateTx,
} from './contest-aggregate.service'
import {
  defaultScoringRules,
  lockContestRatingConfigTx,
  trackForFormat,
} from '../rating/application/contest-rating.service'

export interface CreateContestRuntimeInput {
  teamId: string | null
  organizationId: string | null
  scope: string
  title: string
  description: string | null
  format: string
  startTime: Date
  endTime: Date
  status: string
  createdBy: string
  problemIdVisible: boolean
  solutionVisible: boolean
  includeAdminInRanking: boolean
}

/**
 * Create the compatibility runtime and canonical Contest identity as one
 * command. Until lifecycle execution moves off Training, callers receive the
 * runtime row, but they must not assemble the dual write themselves.
 */
export async function createContestRuntimeTx(
  tx: Prisma.TransactionClient,
  input: CreateContestRuntimeInput,
) {
  const runtime = await tx.training.create({
    data: {
      ...input,
      type: 'contest',
      updatedAt: new Date(),
    },
  })
  const track = trackForFormat(runtime.format)
  const scoringRules = defaultScoringRules(track)
  const aggregate = await ensureContestAggregateTx(tx, runtime.id)
  if (!aggregate) throw new Error('Failed to create canonical Contest aggregate')
  await tx.trainingRatingConfig.create({
    data: {
      id: crypto.randomUUID(),
      trainingId: runtime.id,
      contestId: aggregate.id,
      scope: 'NONE',
      track,
      scoringRules,
      rulesHash: crypto.createHash('sha256').update(JSON.stringify({ track, scoringRules })).digest('hex'),
      createdBy: runtime.createdBy,
    },
  })
  return runtime
}

export interface ContestLifecycleMutation {
  runtimeTrainingId: number
  actorUserId: string
  expectedStatus: string
  targetStatus: 'upcoming' | 'ongoing' | 'finished'
  startTime?: Date
  endTime?: Date
}

export interface UpdateContestRuntimeInput {
  runtimeTrainingId: number
  expected: {
    status: string
    format: string
    startTime: Date
    endTime: Date
  }
  patch: {
    title?: string
    description?: string | null
    format?: string
    startTime?: Date
    endTime?: Date
    problemIdVisible?: boolean
    solutionVisible?: boolean
    includeAdminInRanking?: boolean
  }
}

export interface PrepareDemoContestRuntimesInput {
  runtimeTrainingIds: number[]
  startTime: Date
  endTime: Date
}

function reportMissingCanonicalContest(
  runtimeTrainingId: number,
  consumer: string,
  aggregateId?: string,
) {
  const message = aggregateId
    ? 'Contest aggregate has no runtime'
    : 'Contest runtime has no canonical aggregate'
  logger.error(aggregateId ? 'contest_runtime_missing' : 'contest_aggregate_missing', new Error(message), {
    action: 'contest_command',
    metadata: { runtimeTrainingId, consumer, ...(aggregateId ? { contestId: aggregateId } : {}) },
  })
}

/**
 * Delete an unfinalized contest aggregate and its compatibility runtime in
 * dependency order. The canonical Contest owns projection rows that still
 * reference TrainingProblem, so it must be removed before Training.
 */
export async function deleteContestRuntimeTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-command:${runtimeTrainingId}`}, 0)) IS NULL AS locked`

  const aggregate = await tx.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { select: lifecycleRuntimeSelect } },
  })
  const runtime = aggregate?.RuntimeTraining
  if (!runtime) {
    reportMissingCanonicalContest(runtimeTrainingId, 'delete', aggregate?.id)
    return { conflict: 'missing' as const }
  }
  if (aggregate.finalizedStandingId) return { conflict: 'finalized' as const }

  // An unfinalized draft has no durable Rating history. Remove compatibility
  // rows explicitly before the canonical aggregate; their Contest foreign keys
  // are intentionally RESTRICT so accidental historical deletion fails closed.
  await tx.ratingBatch.deleteMany({ where: { contestId: aggregate.id } })
  await tx.contestStandingSnapshot.deleteMany({ where: { contestId: aggregate.id } })
  await tx.trainingRatingConfig.deleteMany({ where: { contestId: aggregate.id } })
  await tx.contest.delete({ where: { id: aggregate.id } })
  await tx.training.delete({ where: { id: runtimeTrainingId } })
  return { conflict: null }
}

export async function createContestProblemRuntimeTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
  data: Omit<Prisma.TrainingProblemUncheckedCreateInput, 'trainingId' | 'orderIndex'>,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-command:${runtimeTrainingId}`}, 0)) IS NULL AS locked`
  const aggregate = await tx.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { select: { id: true } } },
  })
  const runtime = aggregate?.RuntimeTraining
  if (!runtime) reportMissingCanonicalContest(runtimeTrainingId, 'problem_create', aggregate?.id)
  if (!runtime) return { conflict: 'missing' as const, problem: null }
  const maxOrder = await tx.trainingProblem.aggregate({
    where: { trainingId: runtimeTrainingId },
    _max: { orderIndex: true },
  })
  const problem = await tx.trainingProblem.create({
    data: {
      ...data,
      trainingId: runtimeTrainingId,
      orderIndex: (maxOrder._max.orderIndex ?? -1) + 1,
    },
  })
  await syncContestProblemAggregateTx(tx, problem.id)
  return { conflict: null, problem }
}

export async function reorderContestProblemRuntimesTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
  orders: Array<{ id: string; orderIndex: number }>,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-command:${runtimeTrainingId}`}, 0)) IS NULL AS locked`
  const aggregate = await tx.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { select: { id: true } } },
  })
  if (!aggregate?.RuntimeTraining) {
    reportMissingCanonicalContest(runtimeTrainingId, 'problem_reorder', aggregate?.id)
    return { conflict: 'scope' as const }
  }
  const existing = await tx.trainingProblem.findMany({
    where: { trainingId: runtimeTrainingId, Training: { type: 'contest' } },
    select: { id: true },
  })
  const valid = new Set(existing.map(problem => problem.id))
  if (orders.length !== existing.length || orders.some(order => !valid.has(order.id))) {
    return { conflict: 'scope' as const }
  }
  const expectedIndexes = new Set(existing.map((_, index) => index))
  if (new Set(orders.map(order => order.id)).size !== orders.length
    || new Set(orders.map(order => order.orderIndex)).size !== orders.length
    || orders.some(order => !Number.isInteger(order.orderIndex) || !expectedIndexes.has(order.orderIndex))) {
    return { conflict: 'order' as const }
  }
  for (const order of orders) {
    await tx.trainingProblem.update({ where: { id: order.id }, data: { orderIndex: -(order.orderIndex + 1) } })
    await stageContestProblemOrderProjectionTx(tx, order.id, -(order.orderIndex + 1))
  }
  for (const order of orders) {
    await tx.trainingProblem.update({ where: { id: order.id }, data: { orderIndex: order.orderIndex } })
    await syncContestProblemAggregateTx(tx, order.id)
  }
  return { conflict: null }
}

export async function updateContestProblemRuntimeTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
  trainingProblemId: string,
  patch: { alias?: string | null; points?: number | null },
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-command:${runtimeTrainingId}`}, 0)) IS NULL AS locked`
  const aggregate = await tx.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { select: { id: true } } },
  })
  if (!aggregate?.RuntimeTraining) {
    reportMissingCanonicalContest(runtimeTrainingId, 'problem_update', aggregate?.id)
    return { conflict: 'scope' as const, problem: null }
  }
  const existing = await tx.trainingProblem.findFirst({
    where: { id: trainingProblemId, trainingId: runtimeTrainingId, Training: { type: 'contest' } },
    select: { id: true },
  })
  if (!existing) return { conflict: 'scope' as const, problem: null }
  const problem = await tx.trainingProblem.update({
    where: { id: trainingProblemId },
    data: {
      ...(patch.alias !== undefined && { alias: patch.alias }),
      ...(patch.points !== undefined && { points: patch.points }),
    },
  })
  await syncContestProblemAggregateTx(tx, trainingProblemId)
  return { conflict: null, problem }
}

export async function deleteContestProblemRuntimeTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
  trainingProblemId: string,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-command:${runtimeTrainingId}`}, 0)) IS NULL AS locked`
  const aggregate = await tx.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { select: { id: true } } },
  })
  if (!aggregate?.RuntimeTraining) {
    reportMissingCanonicalContest(runtimeTrainingId, 'problem_delete', aggregate?.id)
    return { conflict: 'scope' as const }
  }
  const existing = await tx.trainingProblem.findFirst({
    where: { id: trainingProblemId, trainingId: runtimeTrainingId, Training: { type: 'contest' } },
    select: { id: true },
  })
  if (!existing) return { conflict: 'scope' as const }
  await deleteContestProblemAggregateTx(tx, trainingProblemId)
  await tx.trainingProblem.delete({ where: { id: trainingProblemId } })
  return { conflict: null }
}

const lifecycleRuntimeSelect = {
  id: true,
  type: true,
  status: true,
  format: true,
  createdBy: true,
  startTime: true,
  endTime: true,
  finalizationStatus: true,
  finalizedStandingId: true,
} as const

/** Update canonical contest metadata and its compatibility projection. */
export async function updateContestRuntimeTx(
  tx: Prisma.TransactionClient,
  input: UpdateContestRuntimeInput,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-command:${input.runtimeTrainingId}`}, 0)) IS NULL AS locked`
  const aggregate = await tx.contest.findUnique({
    where: { runtimeTrainingId: input.runtimeTrainingId },
    include: { RuntimeTraining: true },
  })
  const runtime = aggregate?.RuntimeTraining
  if (!runtime) {
    reportMissingCanonicalContest(input.runtimeTrainingId, 'metadata_update', aggregate?.id)
    return { conflict: 'missing' as const, runtime: null }
  }
  const aggregateStartTime = aggregate.startAt || aggregate.contestDate
  const aggregateEndTime = aggregate.endAt || aggregate.contestDate
  if (aggregate.status !== input.expected.status
    || aggregate.format !== input.expected.format
    || aggregateStartTime.getTime() !== input.expected.startTime.getTime()
    || aggregateEndTime.getTime() !== input.expected.endTime.getTime()) {
    return { conflict: 'stale' as const, runtime }
  }

  if (input.patch.format !== undefined && input.patch.format !== aggregate.format) {
    const existing = await tx.trainingRatingConfig.findUnique({ where: { trainingId: runtime.id } })
    if (existing?.lockedAt) return { conflict: 'rating_locked' as const, runtime }
    if (existing) {
      const track = trackForFormat(input.patch.format)
      const scoringRules = defaultScoringRules(track)
      await tx.trainingRatingConfig.update({
        where: { id: existing.id },
        data: {
          contestId: existing.contestId || aggregate.id,
          track,
          scoringRules,
          rulesHash: crypto.createHash('sha256').update(JSON.stringify({ track, scoringRules })).digest('hex'),
          revision: { increment: 1 },
        },
      })
    }
  }

  await tx.contest.update({
    where: { id: aggregate.id },
    data: {
      ...(input.patch.title !== undefined && { title: input.patch.title }),
      ...(input.patch.description !== undefined && { description: input.patch.description }),
      ...(input.patch.format !== undefined && { format: input.patch.format }),
      ...(input.patch.startTime !== undefined && {
        startAt: input.patch.startTime,
        contestDate: input.patch.startTime,
      }),
      ...(input.patch.endTime !== undefined && { endAt: input.patch.endTime }),
      ...(input.patch.problemIdVisible !== undefined && { problemIdVisible: input.patch.problemIdVisible }),
      ...(input.patch.solutionVisible !== undefined && { solutionVisible: input.patch.solutionVisible }),
      ...(input.patch.includeAdminInRanking !== undefined && {
        includeAdminInRanking: input.patch.includeAdminInRanking,
      }),
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  const updated = await projectContestRuntimeTx(tx, aggregate.id)
  if (!updated) {
    reportMissingCanonicalContest(input.runtimeTrainingId, 'metadata_projection', aggregate.id)
    return { conflict: 'missing' as const, runtime: null }
  }
  return { conflict: null, runtime: updated }
}

/**
 * Apply a contest clock/status transition behind the canonical command
 * boundary. Contest is authoritative; Training is updated in the same
 * transaction as a temporary compatibility projection.
 *
 * `expectedStatus` is a small CAS guard. A concurrent command wins cleanly;
 * the loser receives the current runtime instead of overwriting newer state.
 */
export async function transitionContestLifecycleTx(
  tx: Prisma.TransactionClient,
  input: ContestLifecycleMutation,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-command:${input.runtimeTrainingId}`}, 0)) IS NULL AS locked`

  const aggregate = await tx.contest.findUnique({
    where: { runtimeTrainingId: input.runtimeTrainingId },
    include: { RuntimeTraining: { select: lifecycleRuntimeSelect } },
  })
  const runtime = aggregate?.RuntimeTraining
  if (!runtime) {
    reportMissingCanonicalContest(input.runtimeTrainingId, 'lifecycle', aggregate?.id)
    return null
  }

  if (aggregate.status !== input.expectedStatus) {
    return {
      changed: false,
      visibleSubmissionCount: 0,
      runtime,
    }
  }

  const update = await tx.contest.updateMany({
    where: {
      id: aggregate.id,
      status: input.expectedStatus,
    },
    data: {
      status: input.targetStatus,
      ...(input.startTime ? { startAt: input.startTime, contestDate: input.startTime } : {}),
      ...(input.endTime ? { endAt: input.endTime } : {}),
      ...(input.targetStatus === 'finished' ? { finalizationStatus: 'JUDGING' as const } : {}),
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })

  if (!update.count) {
    return {
      changed: false,
      visibleSubmissionCount: 0,
      runtime,
    }
  }

  if (input.targetStatus !== 'upcoming') {
    await lockContestRatingConfigTx(
      tx,
      input.runtimeTrainingId,
      input.actorUserId || aggregate.createdBy || runtime.createdBy,
      aggregate.format || runtime.format,
    )
  }

  const visibleSubmissionCount = input.targetStatus === 'finished'
    ? (await tx.submission.updateMany({
        where: {
          submitScope: 'contest',
          canonicalContestId: aggregate.id,
          isGlobalVisible: false,
        },
        data: { isGlobalVisible: true },
      })).count
    : 0

  const projectedRuntime = await projectContestRuntimeTx(tx, aggregate.id)
  return {
    changed: true,
    visibleSubmissionCount,
    runtime: projectedRuntime,
  }
}

/**
 * Re-open isolated development demo contests without bypassing the canonical
 * aggregate. The caller is still protected by the demo-only route guard.
 * Finalized contests are immutable and must be recreated instead of reset.
 */
export async function prepareDemoContestRuntimesTx(
  tx: Prisma.TransactionClient,
  input: PrepareDemoContestRuntimesInput,
) {
  const ids = [...new Set(input.runtimeTrainingIds)]
  if (!ids.length) return []

  const aggregates = await tx.contest.findMany({
    where: { runtimeTrainingId: { in: ids } },
    include: { RuntimeTraining: { select: lifecycleRuntimeSelect } },
  })
  const byRuntimeId = new Map(aggregates.flatMap(aggregate => aggregate.runtimeTrainingId === null
    ? []
    : [[aggregate.runtimeTrainingId, aggregate] as const]))

  for (const runtimeTrainingId of ids) {
    const aggregate = byRuntimeId.get(runtimeTrainingId)
    if (!aggregate?.RuntimeTraining || aggregate.RuntimeTraining.type !== 'contest') {
      reportMissingCanonicalContest(runtimeTrainingId, 'demo_prepare', aggregate?.id)
      throw new Error(`Demo contest ${runtimeTrainingId} has no canonical aggregate`)
    }
    if (aggregate.finalizedStandingId || aggregate.finalizationStatus === 'FINALIZED') {
      throw new Error(`Demo contest ${runtimeTrainingId} is finalized and cannot be reset`)
    }
  }

  const runtimes = []
  for (const runtimeTrainingId of ids) {
    const aggregate = byRuntimeId.get(runtimeTrainingId)!
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-command:${runtimeTrainingId}`}, 0)) IS NULL AS locked`
    await tx.contest.update({
      where: { id: aggregate.id },
      data: {
        status: 'ongoing',
        startAt: input.startTime,
        contestDate: input.startTime,
        endAt: input.endTime,
        finalizationStatus: 'LIVE',
        statusRevision: { increment: 1 },
        updatedAt: new Date(),
      },
    })
    const runtime = await projectContestRuntimeTx(tx, aggregate.id)
    if (!runtime) throw new Error(`Demo contest ${runtimeTrainingId} projection failed`)
    runtimes.push(runtime)
  }
  return runtimes
}

const rejudgeRuntimeSelect = {
  id: true,
  type: true,
  finalizationStatus: true,
  finalizedStandingId: true,
} as const

/**
 * Put a finalized contest into the explicit post-rejudge hold state.
 *
 * Contest owns finalization state. Training is updated only as a compatibility
 * projection for consumers that have not yet moved to the aggregate.
 */
export async function holdContestFinalizationForRejudgeTx(
  tx: Prisma.TransactionClient,
  runtimeTrainingId: number,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-command:${runtimeTrainingId}`}, 0)) IS NULL AS locked`

  const aggregate = await tx.contest.findUnique({
    where: { runtimeTrainingId },
    include: { RuntimeTraining: { select: rejudgeRuntimeSelect } },
  })

  const runtime = aggregate?.RuntimeTraining
  if (!runtime) {
    reportMissingCanonicalContest(runtimeTrainingId, 'rejudge', aggregate?.id)
    return false
  }
  if (runtime.type !== 'contest') {
    logger.error('contest_runtime_type_mismatch', new Error('Contest runtime is not a contest'), {
      action: 'contest_command',
      metadata: { contestId: aggregate?.id, runtimeTrainingId, consumer: 'rejudge' },
    })
    return false
  }
  if (!aggregate.finalizedStandingId || aggregate.finalizationStatus !== 'FINALIZED') return false

  const updated = await tx.contest.updateMany({
    where: {
      id: aggregate.id,
      finalizedStandingId: aggregate.finalizedStandingId,
      finalizationStatus: 'FINALIZED',
    },
    data: {
      finalizationStatus: 'HELD',
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  if (!updated.count) return false

  await projectContestRuntimeTx(tx, aggregate.id)
  return true
}
