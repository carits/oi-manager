import type { Prisma } from '@prisma/client'
import crypto from 'node:crypto'
import logger from '../../lib/logger'
import {
  defaultScoringRules,
  lockContestRatingConfigTx,
  trackForFormat,
} from '../rating/application/contest-rating.service'
import { toContestView, toContestProblemView } from './contest-view'
import { acquireTestSetReaderTx, releaseTestSetReaderTx } from '../problem/problem.testset-slot.service'

export class ContestRejudgeBarrierError extends Error {
  readonly statusCode = 409
  readonly code = 'CONTEST_TEST_SET_NO_LONGER_AVAILABLE'

  constructor(message = '比赛固定使用的 Stable 数据已被替换，无法再对该比赛执行重新评测') {
    super(message)
    this.name = 'ContestRejudgeBarrierError'
  }
}

export interface CreateContestInput {
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

export interface ContestLifecycleMutation {
  publicId: number
  actorUserId: string
  expectedStatus: string
  targetStatus: 'upcoming' | 'ongoing' | 'finished'
  startTime?: Date
  endTime?: Date
}

export interface UpdateContestInput {
  publicId: number
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

export interface PrepareDemoContestsInput {
  publicIds: number[]
  startTime: Date
  endTime: Date
}

type ContestProblemCreateInput = {
  id?: string
  problemId: string
  alias?: string | null
  points?: number | null
  title?: string | null
  description?: string | null
  sourcePlatform?: string | null
  sourceProblemId?: string | null
}

async function lockContest(tx: Prisma.TransactionClient, publicId: number) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contest-command:${publicId}`}, 0)) IS NULL AS locked`
}

async function findContest(tx: Prisma.TransactionClient, publicId: number) {
  return tx.contest.findUnique({
    where: { publicId },
    include: {
      Team: true,
      RatingConfig: true,
      ContestProblem: {
        include: { CanonicalProblem: true, ContestResource: true },
        orderBy: { orderIndex: 'asc' },
      },
      _count: { select: { ContestProblem: true, Submissions: true } },
    },
  })
}

function reportMissingContest(publicId: number, consumer: string) {
  logger.error('contest_missing', new Error('Contest does not exist'), {
    action: 'contest_command',
    metadata: { publicId, consumer },
  })
}

export async function createContestTx(
  tx: Prisma.TransactionClient,
  input: CreateContestInput,
) {
  const contest = await tx.contest.create({
    data: {
      id: crypto.randomUUID(),
      createdBy: input.createdBy,
      organizationId: input.organizationId,
      title: input.title,
      description: input.description,
      contestDate: input.startTime,
      startAt: input.startTime,
      endAt: input.endTime,
      format: input.format,
      status: input.status,
      type: 'judged',
      teamId: input.teamId,
      scope: input.scope,
      problemIdVisible: input.problemIdVisible,
      solutionVisible: input.solutionVisible,
      includeAdminInRanking: input.includeAdminInRanking,
      updatedAt: new Date(),
    },
  })
  const track = trackForFormat(input.format)
  const scoringRules = defaultScoringRules(track)
  await tx.contestRatingConfig.create({
    data: {
      id: crypto.randomUUID(),
      contestId: contest.id,
      scope: 'NONE',
      track,
      scoringRules,
      rulesHash: crypto.createHash('sha256').update(JSON.stringify({ track, scoringRules })).digest('hex'),
      createdBy: input.createdBy,
    },
  })
  return toContestView(await findContest(tx, contest.publicId))
}

export async function deleteContestTx(
  tx: Prisma.TransactionClient,
  publicId: number,
) {
  await lockContest(tx, publicId)
  const contest = await tx.contest.findUnique({
    where: { publicId },
    select: { id: true, finalizedStandingId: true },
  })
  if (!contest) {
    reportMissingContest(publicId, 'delete')
    return { conflict: 'missing' as const }
  }
  if (contest.finalizedStandingId) return { conflict: 'finalized' as const }
  await tx.ratingBatch.deleteMany({ where: { contestId: contest.id } })
  await tx.contestStandingSnapshot.deleteMany({ where: { contestId: contest.id } })
  await tx.contestRatingConfig.deleteMany({ where: { contestId: contest.id } })
  await tx.contest.delete({ where: { id: contest.id } })
  return { conflict: null }
}

export async function createContestProblemTx(
  tx: Prisma.TransactionClient,
  publicId: number,
  data: ContestProblemCreateInput,
) {
  await lockContest(tx, publicId)
  const contest = await tx.contest.findUnique({
    where: { publicId },
    select: { id: true, solutionVisible: true },
  })
  if (!contest) {
    reportMissingContest(publicId, 'problem_create')
    return { conflict: 'missing' as const, problem: null }
  }
  const problem = await tx.problem.findUnique({ where: { id: data.problemId } })
  if (!problem) return { conflict: 'problem' as const, problem: null }
  const stable = await tx.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: problem.id, slot: 'STABLE' } } })
  if (!stable) return { conflict: 'test_set' as const, problem: null }
  const maxOrder = await tx.contestProblem.aggregate({
    where: { contestId: contest.id },
    _max: { orderIndex: true },
  })
  const created = await tx.contestProblem.create({
    data: {
      id: data.id || crypto.randomUUID(),
      contestId: contest.id,
      canonicalProblemId: problem.id,
      testSetSlot: 'STABLE',
      testSetGraphHash: stable.graphHash,
      testSetJudgeConfigHash: stable.judgeConfigHash,
      testSetFencingToken: stable.fencingToken,
      orderIndex: (maxOrder._max.orderIndex ?? -1) + 1,
      alias: data.alias ?? null,
      title: data.title || problem.title,
      ojName: data.sourcePlatform || problem.platform,
      problemId: data.sourceProblemId || problem.problemId,
      difficulty: problem.difficulty,
      points: data.points ?? null,
      statementType: data.description ? 'markdown' : 'none',
      statementMarkdown: data.description || null,
      solutionVisible: contest.solutionVisible,
      updatedAt: new Date(),
    },
    include: { CanonicalProblem: true, ContestResource: true },
  })
  return { conflict: null, problem: toContestProblemView(created, contest.id) }
}

export async function reorderContestProblemsTx(
  tx: Prisma.TransactionClient,
  publicId: number,
  orders: Array<{ id: string; orderIndex: number }>,
) {
  await lockContest(tx, publicId)
  const contest = await tx.contest.findUnique({
    where: { publicId },
    select: { id: true, ContestProblem: { select: { id: true } } },
  })
  if (!contest) return { conflict: 'scope' as const }
  const valid = new Set(contest.ContestProblem.map(problem => problem.id))
  if (orders.length !== valid.size || orders.some(order => !valid.has(order.id))) {
    return { conflict: 'scope' as const }
  }
  const expectedIndexes = new Set(contest.ContestProblem.map((_, index) => index))
  if (new Set(orders.map(order => order.id)).size !== orders.length
    || new Set(orders.map(order => order.orderIndex)).size !== orders.length
    || orders.some(order => !Number.isInteger(order.orderIndex) || !expectedIndexes.has(order.orderIndex))) {
    return { conflict: 'order' as const }
  }
  for (const order of orders) {
    await tx.contestProblem.update({ where: { id: order.id }, data: { orderIndex: -(order.orderIndex + 1) } })
  }
  for (const order of orders) {
    await tx.contestProblem.update({ where: { id: order.id }, data: { orderIndex: order.orderIndex } })
  }
  return { conflict: null }
}

export async function updateContestProblemTx(
  tx: Prisma.TransactionClient,
  publicId: number,
  contestProblemId: string,
  patch: { alias?: string | null; points?: number | null },
) {
  await lockContest(tx, publicId)
  const contest = await tx.contest.findUnique({ where: { publicId }, select: { id: true } })
  if (!contest) return { conflict: 'scope' as const, problem: null }
  const existing = await tx.contestProblem.findFirst({
    where: { id: contestProblemId, contestId: contest.id },
  })
  if (!existing) return { conflict: 'scope' as const, problem: null }
  const problem = await tx.contestProblem.update({
    where: { id: contestProblemId },
    data: {
      ...(patch.alias !== undefined && { alias: patch.alias }),
      ...(patch.points !== undefined && { points: patch.points }),
      updatedAt: new Date(),
    },
    include: { CanonicalProblem: true, ContestResource: true },
  })
  return { conflict: null, problem: toContestProblemView(problem, contest.id) }
}

export async function deleteContestProblemTx(
  tx: Prisma.TransactionClient,
  publicId: number,
  contestProblemId: string,
) {
  await lockContest(tx, publicId)
  const contest = await tx.contest.findUnique({ where: { publicId }, select: { id: true } })
  if (!contest) return { conflict: 'scope' as const }
  const item = await tx.contestProblem.findFirst({ where: { id: contestProblemId, contestId: contest.id }, select: { testSetReaderId: true } })
  if (item?.testSetReaderId) await releaseTestSetReaderTx(tx, item.testSetReaderId)
  const deleted = await tx.contestProblem.deleteMany({
    where: { id: contestProblemId, contestId: contest.id },
  })
  return { conflict: deleted.count === 1 ? null : 'scope' as const }
}

export async function updateContestTx(
  tx: Prisma.TransactionClient,
  input: UpdateContestInput,
) {
  const publicId = input.publicId
  await lockContest(tx, publicId)
  const contest = await findContest(tx, publicId)
  if (!contest) {
    reportMissingContest(publicId, 'metadata_update')
    return { conflict: 'missing' as const, contest: null }
  }
  const startTime = contest.startAt || contest.contestDate
  const endTime = contest.endAt || contest.contestDate
  const contestView = toContestView(contest)
  if (contest.status !== input.expected.status
    || contest.format !== input.expected.format
    || startTime.getTime() !== input.expected.startTime.getTime()
    || endTime.getTime() !== input.expected.endTime.getTime()) {
    return { conflict: 'stale' as const, contest: contestView }
  }
  if (input.patch.format !== undefined && input.patch.format !== contest.format) {
    if (contest.RatingConfig?.lockedAt) return { conflict: 'rating_locked' as const, contest: contestView }
    if (contest.RatingConfig) {
      const track = trackForFormat(input.patch.format)
      const scoringRules = defaultScoringRules(track)
      await tx.contestRatingConfig.update({
        where: { id: contest.RatingConfig.id },
        data: {
          track,
          scoringRules,
          rulesHash: crypto.createHash('sha256').update(JSON.stringify({ track, scoringRules })).digest('hex'),
          revision: { increment: 1 },
        },
      })
    }
  }
  await tx.contest.update({
    where: { id: contest.id },
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
  return { conflict: null, contest: toContestView(await findContest(tx, publicId)) }
}

export async function transitionContestLifecycleTx(
  tx: Prisma.TransactionClient,
  input: ContestLifecycleMutation,
) {
  const publicId = input.publicId
  await lockContest(tx, publicId)
  const contest = await findContest(tx, publicId)
  if (!contest) {
    reportMissingContest(publicId, 'lifecycle')
    return null
  }
  const contestView = toContestView(contest)
  if (contest.status !== input.expectedStatus) {
    return { changed: false, visibleSubmissionCount: 0, contest: contestView }
  }
  if (['upcoming', 'ongoing'].includes(input.targetStatus)) {
    for (const item of contest.ContestProblem) {
      if (!item.canonicalProblemId || item.testSetReaderId) continue
      const acquired = await acquireTestSetReaderTx(tx, {
        problemId: item.canonicalProblemId,
        slot: 'STABLE',
        ownerType: 'CONTEST_PROBLEM',
        ownerId: item.id,
      })
      await tx.contestProblem.update({
        where: { id: item.id },
        data: {
          testSetReaderId: acquired.reader.id,
          testSetSlot: 'STABLE',
          testSetGraphHash: acquired.slot.graphHash,
          testSetJudgeConfigHash: acquired.slot.judgeConfigHash,
          testSetFencingToken: acquired.slot.fencingToken,
        },
      })
    }
  }
  const update = await tx.contest.updateMany({
    where: { id: contest.id, status: input.expectedStatus },
    data: {
      status: input.targetStatus,
      ...(input.startTime ? { startAt: input.startTime, contestDate: input.startTime } : {}),
      ...(input.endTime ? { endAt: input.endTime } : {}),
      ...(input.targetStatus === 'finished' ? { finalizationStatus: 'JUDGING' as const } : {}),
      statusRevision: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  if (!update.count) return { changed: false, visibleSubmissionCount: 0, contest: contestView }
  if (input.targetStatus !== 'upcoming') {
    await lockContestRatingConfigTx(
      tx,
      publicId,
      input.actorUserId || contest.createdBy || '',
      contest.format || 'ioi',
    )
  }
  const visibleSubmissionCount = input.targetStatus === 'finished'
    ? (await tx.submission.updateMany({
        where: { submitScope: 'contest', canonicalContestId: contest.id, isGlobalVisible: false },
        data: { isGlobalVisible: true },
      })).count
    : 0
  return {
    changed: true,
    visibleSubmissionCount,
    contest: toContestView(await findContest(tx, publicId)),
  }
}

export async function prepareDemoContestsTx(
  tx: Prisma.TransactionClient,
  input: PrepareDemoContestsInput,
) {
  const ids = [...new Set(input.publicIds)]
  const contests = await tx.contest.findMany({ where: { publicId: { in: ids } } })
  const byId = new Map(contests.map(contest => [contest.publicId, contest]))
  if (contests.length !== ids.length) throw new Error('One or more demo contests do not exist')
  for (const publicId of ids) {
    const contest = byId.get(publicId)!
    if (contest.finalizedStandingId || contest.finalizationStatus === 'FINALIZED') {
      throw new Error(`Demo contest ${publicId} is finalized and cannot be reset`)
    }
    await lockContest(tx, publicId)
    await tx.contest.update({
      where: { id: contest.id },
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
  }
  const refreshed = []
  for (const publicId of ids) refreshed.push(toContestView(await findContest(tx, publicId)))
  return refreshed
}

/**
 * Re-establish the Contest Stable barrier before a rejudge batch. Once a
 * finalized Contest releases its readers, rejudge is safe only while every
 * current Stable slot still matches the graph/fence captured at publication.
 */
export async function ensureContestRejudgeBarrierTx(
  tx: Prisma.TransactionClient,
  contestId: string,
) {
  const identity = await tx.contest.findUnique({ where: { id: contestId }, select: { publicId: true } })
  if (!identity) throw new ContestRejudgeBarrierError('比赛不存在')
  await lockContest(tx, identity.publicId)
  const contest = await tx.contest.findUnique({
    where: { id: contestId },
    include: {
      ContestProblem: {
        where: { canonicalProblemId: { not: null } },
        select: {
          id: true,
          canonicalProblemId: true,
          testSetGraphHash: true,
          testSetFencingToken: true,
          testSetReaderId: true,
        },
      },
    },
  })
  if (!contest) throw new ContestRejudgeBarrierError('比赛不存在')
  for (const item of contest.ContestProblem) {
    if (!item.canonicalProblemId || !item.testSetGraphHash || item.testSetFencingToken == null) {
      throw new ContestRejudgeBarrierError('比赛题目缺少已发布的 Stable 数据快照')
    }
    let acquired
    try {
      acquired = await acquireTestSetReaderTx(tx, {
        problemId: item.canonicalProblemId,
        slot: 'STABLE',
        ownerType: 'CONTEST_PROBLEM',
        ownerId: item.id,
      })
    } catch {
      throw new ContestRejudgeBarrierError('Stable 数据正在更新，无法为比赛重新建立评测屏障')
    }
    if (acquired.slot.graphHash !== item.testSetGraphHash || acquired.slot.fencingToken !== item.testSetFencingToken) {
      throw new ContestRejudgeBarrierError()
    }
    if (item.testSetReaderId !== acquired.reader.id) {
      await tx.contestProblem.update({ where: { id: item.id }, data: { testSetReaderId: acquired.reader.id } })
    }
  }
  if (contest.finalizationStatus === 'FINALIZED') {
    if (!contest.finalizedStandingId) throw new ContestRejudgeBarrierError('比赛结算快照不完整，无法进入重新评测')
    const held = await tx.contest.updateMany({
      where: { id: contest.id, finalizationStatus: 'FINALIZED', finalizedStandingId: contest.finalizedStandingId },
      data: { finalizationStatus: 'HELD', statusRevision: { increment: 1 }, updatedAt: new Date() },
    })
    if (held.count !== 1) throw new ContestRejudgeBarrierError('比赛结算状态已变化，请刷新后重试')
  }
  return true
}
