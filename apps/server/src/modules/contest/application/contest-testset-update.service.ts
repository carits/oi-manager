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
  const contest = await client.contest.findUnique({ where: { publicId: contestId }, select: { id: true, publicId: true, startAt: true, contestDate: true } })
  if (!contest) return null
  const problem = await client.contestProblem.findFirst({
    where: { id: contestProblemId, contestId: contest.id },
    include: { TestSetRevision: true, CanonicalProblem: { include: { LatestTestSetRevision: true } } },
  })
  return problem ? { contest, problem } : null
}

async function revisionState(client: any, item: any) {
  const submissionCount = await client.submission.count({
    where: { canonicalContestProblemId: item.problem.id },
  })
  const started = new Date() >= (item.contest.startAt || item.contest.contestDate)
  const frozen = started || submissionCount > 0
  const latest = item.problem.CanonicalProblem.LatestTestSetRevision
  const current = item.problem.TestSetRevision
  return {
    currentRevisionId: current?.id || null,
    currentRevision: current?.revisionNumber || null,
    latestRevisionId: latest?.id || null,
    latestRevision: latest?.revisionNumber || null,
    pending: Boolean(latest && latest.id !== current?.id),
    frozen,
    frozenReason: started ? '比赛已经开始' : submissionCount > 0 ? '比赛已经存在提交记录' : null,
    submissionCount,
  }
}

async function requireManagedContext(contestId: number, contestProblemId: string, userId: string) {
  const [item, access] = await Promise.all([loadContext(prisma, contestId, contestProblemId), findContestForAccess(contestId)])
  if (!item || !access) fail(404, 'CONTEST_PROBLEM_NOT_FOUND', '比赛题目不存在')
  if (!await canManageContest(userId, access.contest)) fail(403, 'CONTEST_MANAGE_DENIED', '无比赛管理权限')
  return item
}

export async function previewContestTestSetUpdate(
  contestId: number,
  contestProblemId: string,
  userId: string,
) {
  const item = await requireManagedContext(contestId, contestProblemId, userId)
  return {
    contestProblemId: item.problem.id,
    problemId: item.problem.canonicalProblemId,
    problemTitle: item.problem.CanonicalProblem.title,
    ...await revisionState(prisma, item),
  }
}

export async function updateContestTestSetRevision(params: {
  contestId: number
  contestProblemId: string
  userId: string
  revisionId?: string
}) {
  await requireManagedContext(params.contestId, params.contestProblemId, params.userId)
  return prisma.$transaction(async tx => {
    const item = await loadContext(tx, params.contestId, params.contestProblemId)
    if (!item) fail(404, 'CONTEST_PROBLEM_NOT_FOUND', '比赛题目不存在')
    const state = await revisionState(tx, item)
    if (state.frozen) {
      fail(
        409,
        'TEST_SET_REVISION_FROZEN',
        `${state.frozenReason}，测试版本已永久冻结`,
        state,
      )
    }
    const revisionId = params.revisionId || item.problem.CanonicalProblem.latestTestSetRevisionId
    if (!revisionId) {
      fail(409, 'TEST_SET_REVISION_REQUIRED', '题库尚无正式测试版本')
    }
    const revision = await tx.problemTestSetRevision.findFirst({
      where: { id: revisionId, problemId: item.problem.canonicalProblemId },
    })
    if (!revision) fail(404, 'TEST_SET_REVISION_NOT_FOUND', '测试版本不存在')
    if (revision.id === item.problem.testSetRevisionId) {
      return { updated: false, state, message: '比赛已经使用该测试版本' }
    }
    await tx.contestProblem.update({
      where: { id: item.problem.id },
      data: { testSetRevisionId: revision.id, updatedAt: new Date() },
    })
    return {
      updated: true,
      previousRevisionId: item.problem.testSetRevisionId,
      currentRevisionId: revision.id,
      currentRevision: revision.revisionNumber,
      message: `比赛已固定到测试版本 R${revision.revisionNumber}`,
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
