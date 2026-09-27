import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { canManageContest } from '../contest.helpers'
import { findContestForAccess } from '../../contest/contest-query.facade'

export class ContestTestSetUpdateError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string, data?: unknown): never {
  throw new ContestTestSetUpdateError(statusCode, code, message, data)
}

async function loadContext(client: any, contestId: number, contestProblemId: string) {
  const contest = await client.contest.findUnique({
    where: { publicId: contestId },
    select: { id: true, publicId: true, startAt: true, contestDate: true },
  })
  if (!contest) return null
  const problem = await client.contestProblem.findFirst({
    where: { id: contestProblemId, contestId: contest.id },
    include: {
      CanonicalProblem: {
        include: { TestSetSlots: { where: { slot: 'STABLE' } } },
      },
    },
  })
  return problem ? { contest, problem } : null
}

async function stableState(client: any, item: any) {
  const submissionCount = await client.submission.count({
    where: { canonicalContestProblemId: item.problem.id },
  })
  const started = new Date() >= (item.contest.startAt || item.contest.contestDate)
  const frozen = started || submissionCount > 0 || Boolean(item.problem.testSetReaderId)
  const stable = item.problem.CanonicalProblem.TestSetSlots[0] || null
  return {
    currentGraphHash: item.problem.testSetGraphHash,
    currentFencingToken: item.problem.testSetFencingToken,
    stableGraphHash: stable?.graphHash || null,
    stableFencingToken: stable?.fencingToken ?? null,
    pending: Boolean(stable && (
      stable.graphHash !== item.problem.testSetGraphHash
      || stable.fencingToken !== item.problem.testSetFencingToken
    )),
    frozen,
    frozenReason: started
      ? '比赛已经开始'
      : submissionCount > 0
        ? '比赛已经存在提交记录'
        : item.problem.testSetReaderId
          ? '比赛已持有 Stable 数据读取屏障'
          : null,
    submissionCount,
  }
}

async function requireManagedContext(contestId: number, contestProblemId: string, userId: string) {
  const [item, access] = await Promise.all([
    loadContext(prisma, contestId, contestProblemId),
    findContestForAccess(contestId),
  ])
  if (!item || !access) fail(404, 'CONTEST_PROBLEM_NOT_FOUND', '比赛题目不存在')
  if (!await canManageContest(userId, access.contest)) {
    fail(403, 'CONTEST_MANAGE_DENIED', '无比赛管理权限')
  }
  return item
}

export async function previewContestStableSnapshot(
  contestId: number,
  contestProblemId: string,
  userId: string,
) {
  const item = await requireManagedContext(contestId, contestProblemId, userId)
  return {
    contestProblemId: item.problem.id,
    problemId: item.problem.canonicalProblemId,
    problemTitle: item.problem.CanonicalProblem.title,
    ...await stableState(prisma, item),
  }
}

export async function refreshContestStableSnapshot(params: {
  contestId: number
  contestProblemId: string
  userId: string
}) {
  await requireManagedContext(params.contestId, params.contestProblemId, params.userId)
  return prisma.$transaction(async tx => {
    const item = await loadContext(tx, params.contestId, params.contestProblemId)
    if (!item) fail(404, 'CONTEST_PROBLEM_NOT_FOUND', '比赛题目不存在')
    const state = await stableState(tx, item)
    if (state.frozen) {
      fail(409, 'CONTEST_STABLE_SNAPSHOT_FROZEN', `${state.frozenReason}，不能刷新 Stable 数据快照`, state)
    }
    const stable = item.problem.CanonicalProblem.TestSetSlots[0]
    if (!stable) fail(409, 'STABLE_TEST_SET_REQUIRED', '题目尚无 Stable 测试数据')
    if (!state.pending) {
      return { updated: false as const, state, message: '比赛已经使用当前 Stable 数据' }
    }
    const previousGraphHash = item.problem.testSetGraphHash
    await tx.contestProblem.update({
      where: { id: item.problem.id },
      data: {
        testSetSlot: 'STABLE',
        testSetGraphHash: stable.graphHash,
        testSetJudgeConfigHash: stable.judgeConfigHash,
        testSetFencingToken: stable.fencingToken,
        updatedAt: new Date(),
      },
    })
    return {
      updated: true as const,
      previousGraphHash,
      currentGraphHash: stable.graphHash,
      currentFencingToken: stable.fencingToken,
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
