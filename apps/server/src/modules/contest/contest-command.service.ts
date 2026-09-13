import type { Prisma } from '@prisma/client'
import crypto from 'node:crypto'
import logger from '../../lib/logger'
import {
  deleteContestProblemAggregateTx,
  ensureContestAggregateTx,
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
  await tx.trainingRatingConfig.create({
    data: {
      id: crypto.randomUUID(),
      trainingId: runtime.id,
      scope: 'NONE',
      track,
      scoringRules,
      rulesHash: crypto.createHash('sha256').update(JSON.stringify({ track, scoringRules })).digest('hex'),
      createdBy: runtime.createdBy,
    },
  })
  await ensureContestAggregateTx(tx, runtime.id)
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
  if (runtime.finalizedStandingId) return { conflict: 'finalized' as const }

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

/** Update editable contest metadata and its aggregate as one command. */
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
  if (runtime.status !== input.expected.status
    || runtime.format !== input.expected.format
    || runtime.startTime.getTime() !== input.expected.startTime.getTime()
    || runtime.endTime.getTime() !== input.expected.endTime.getTime()) {
    return { conflict: 'stale' as const, runtime }
  }

  if (input.patch.format !== undefined && input.patch.format !== runtime.format) {
    const existing = await tx.trainingRatingConfig.findUnique({ where: { trainingId: runtime.id } })
    if (existing?.lockedAt) return { conflict: 'rating_locked' as const, runtime }
    if (existing) {
      const track = trackForFormat(input.patch.format)
      const scoringRules = defaultScoringRules(track)
      await tx.trainingRatingConfig.update({
        where: { id: existing.id },
        data: {
          track,
          scoringRules,
          rulesHash: crypto.createHash('sha256').update(JSON.stringify({ track, scoringRules })).digest('hex'),
          revision: { increment: 1 },
        },
      })
    }
  }

  const updated = await tx.training.update({
    where: { id: runtime.id },
    data: input.patch,
  })
  await ensureContestAggregateTx(tx, runtime.id)
  return { conflict: null, runtime: updated }
}

/**
 * Apply a contest clock/status transition behind the canonical command
 * boundary. The Training row remains the compatibility runtime for now, but
 * callers cannot update it and then separately attempt to repair Contest.
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

  const update = await tx.training.updateMany({
    where: {
      id: input.runtimeTrainingId,
      type: 'contest',
      status: input.expectedStatus,
    },
    data: {
      status: input.targetStatus,
      ...(input.startTime ? { startTime: input.startTime } : {}),
      ...(input.endTime ? { endTime: input.endTime } : {}),
      ...(input.targetStatus === 'finished' ? { finalizationStatus: 'JUDGING' as const } : {}),
    },
  })

  if (!update.count) {
    return {
      changed: false,
      visibleSubmissionCount: 0,
      runtime: await tx.training.findUniqueOrThrow({
        where: { id: input.runtimeTrainingId },
      }),
    }
  }

  if (input.targetStatus !== 'upcoming') {
    await lockContestRatingConfigTx(
      tx,
      input.runtimeTrainingId,
      input.actorUserId || runtime.createdBy,
      runtime.format,
    )
  }

  const visibleSubmissionCount = input.targetStatus === 'finished'
    ? (await tx.submission.updateMany({
        where: {
          submitScope: 'contest',
          contestId: input.runtimeTrainingId,
          isGlobalVisible: false,
        },
        data: { isGlobalVisible: true },
      })).count
    : 0

  await ensureContestAggregateTx(tx, input.runtimeTrainingId)
  return {
    changed: true,
    visibleSubmissionCount,
    runtime: await tx.training.findUniqueOrThrow({
      where: { id: input.runtimeTrainingId },
    }),
  }
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
 * Training still owns the runtime/finalization columns during the Contest
 * strangler migration, but callers must not interpret or mutate those columns
 * directly. This command is the single compatibility boundary until the
 * fields move onto the canonical Contest aggregate.
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
  if (!runtime.finalizedStandingId || runtime.finalizationStatus !== 'FINALIZED') return false

  const updated = await tx.training.updateMany({
    where: {
      id: runtimeTrainingId,
      type: 'contest',
      finalizedStandingId: runtime.finalizedStandingId,
      finalizationStatus: 'FINALIZED',
    },
    data: { finalizationStatus: 'HELD' },
  })
  if (!updated.count) return false

  return true
}
