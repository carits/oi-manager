import { prisma } from '../../../prisma'
import {
  CURRENT_JUDGE_RUN_SELECT,
  currentJudgeCompletedWhere,
  currentJudgeInProgressWhere,
  currentJudgeResultWhere,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import { toContestProblemView } from '../../contest/contest-view'

export const localJudgeSubmissionWhere = () => ({
  problemInternalId: { not: null },
  OR: [{ submitMethod: { in: ['local', 'demo_scenario'] } }, { oj: 'carits' }],
})

async function findContest(publicId: number) {
  return prisma.contest.findUnique({
    where: { publicId },
    select: { id: true, publicId: true },
  })
}

export async function loadContestProblemForSubmission(contestId: number, contestProblemId: string) {
  const contest = await findContest(contestId)
  if (!contest) return null
  const row = await prisma.contestProblem.findFirst({
    where: { id: contestProblemId, contestId: contest.id },
    include: {
      ContestResource: true,
      CanonicalProblem: true,
      TestSetReader: { include: { Slot: true } },
    },
  })
  return row ? toContestProblemView(row, contest.publicId) : null
}

export function countProblemTestdata(problemId: string) {
  return prisma.testdataFile.count({ where: { problemId } })
}

export async function queryContestSubmissions(params: {
  contest: any
  requesterId: string
  isAdmin: boolean
  filters: { userId?: string; problemId?: string; username?: string; result?: string; language?: string }
  pagination: { skip: number; pageSize: number }
}) {
  const { contest, requesterId, isAdmin, filters, pagination } = params
  const where: any = {
    submitScope: 'contest',
    canonicalContestId: contest.canonicalContestId,
    currentJudgeRunId: { not: null },
    AND: [],
  }
  if (filters.userId) where.userId = filters.userId
  if (filters.problemId) {
    const contestProblem = await prisma.contestProblem.findFirst({
      where: { id: filters.problemId, contestId: contest.canonicalContestId },
      select: { id: true, problemId: true, CanonicalProblem: { select: { problemId: true } } },
    })
    where.problemId = contestProblem?.problemId || contestProblem?.CanonicalProblem?.problemId || filters.problemId
  }
  if (filters.result) where.AND.push(currentJudgeResultWhere(filters.result))
  if (filters.language) where.language = filters.language
  if (!isAdmin) {
    if (where.userId && where.userId !== requesterId) return { empty: true as const }
    where.userId = requesterId
  }
  if (filters.username?.trim()) {
    const matching = await prisma.user.findMany({
      where: { username: { contains: filters.username.trim() } }, select: { id: true },
    })
    const ids = matching.map(user => user.id)
    if (!ids.length) return { empty: true as const }
    if (typeof where.userId === 'string') {
      if (!ids.includes(where.userId)) return { empty: true as const }
      where.userId = { in: [where.userId] }
    } else where.userId = { in: ids }
  }
  const contestProblemsPromise = prisma.contestProblem.findMany({
    where: { contestId: contest.canonicalContestId },
    select: {
      id: true, canonicalProblemId: true, alias: true, orderIndex: true,
      CanonicalProblem: { select: { problemId: true, judgeConfig: true } },
    },
  }).then(rows => rows.map(row => ({
    id: row.id,
    problemId: row.canonicalProblemId,
    alias: row.alias,
    orderIndex: row.orderIndex,
    Problem: row.CanonicalProblem,
  })))

  const [rawSubmissions, total, contestProblems] = await Promise.all([
    prisma.submission.findMany({
      where,
      include: { CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT } },
      orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.pageSize,
    }),
    prisma.submission.count({ where }),
    contestProblemsPromise,
  ])
  const submissions = rawSubmissions.map(projectSubmissionJudgeResult)
  const userIds = [...new Set(submissions.map(submission => submission.userId))]
  const [users, memberships] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }),
    contest.organizationId ? prisma.organizationMembership.findMany({
      where: { organizationId: contest.organizationId, userId: { in: userIds }, status: 'active' },
      select: {
        userId: true, memberRole: true,
        StudentProfile: { select: { name: true } }, TeacherProfile: { select: { name: true } },
      },
    }) : Promise.resolve([]),
  ])
  return { empty: false as const, submissions, total, contestProblems, users, memberships }
}

export async function loadContestSubmissionDetail(contestId: number, submissionId: number, submitScope: string) {
  if (submitScope !== 'contest') return null
  const contest = await findContest(contestId)
  if (!contest) return null
  const submission = await prisma.submission.findFirst({
    where: { id: submissionId, submitScope: 'contest', canonicalContestId: contest.id },
    include: { CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT } },
  })
  if (!submission) return null
  const projectedSubmission = projectSubmissionJudgeResult(submission)
  const contestProblemPromise = prisma.contestProblem.findFirst({
    where: {
      contestId: contest.id,
      OR: [
        ...(projectedSubmission.canonicalContestProblemId ? [{ id: projectedSubmission.canonicalContestProblemId }] : []),
        { problemId: projectedSubmission.problemId },
        { CanonicalProblem: { problemId: projectedSubmission.problemId } },
      ],
    },
    include: { CanonicalProblem: { select: { platform: true, judgeConfig: true } } },
  }).then(row => row ? { ...row, Problem: row.CanonicalProblem } : null)
  const [contestProblem, submitter] = await Promise.all([
    contestProblemPromise,
    prisma.user.findUnique({ where: { id: projectedSubmission.userId }, select: { username: true } }),
  ])
  return { submission: projectedSubmission, contestProblem, submitter }
}

export async function listContestSubmissionUsers(contestId: number) {
  const contest = await findContest(contestId)
  if (!contest) return []
  return prisma.user.findMany({
    where: {
      Submission: {
        some: {
          canonicalContestId: contest.id,
          ...localJudgeSubmissionWhere(),
        },
      },
    },
    select: { id: true, username: true }, orderBy: { username: 'asc' },
  })
}

export async function buildRejudgeTarget(params: {
  contest: any
  scopeType: string
  contestProblemId?: string
  userId?: string
}) {
  const where: any = {
    canonicalContestId: params.contest.canonicalContestId,
    submitScope: 'contest',
    AND: [localJudgeSubmissionWhere()],
  }
  if (params.scopeType === 'problem' || params.scopeType === 'user_problem') {
    const problem = await prisma.contestProblem.findFirst({
      where: { id: params.contestProblemId, contestId: params.contest.canonicalContestId },
      select: { id: true, problemId: true, CanonicalProblem: { select: { problemId: true } } },
    })
    if (!problem) return null
    where.AND.push({
      OR: [
        { canonicalContestProblemId: problem.id },
        { problemId: problem.problemId || problem.CanonicalProblem?.problemId || '' },
      ],
    })
  }
  if (params.scopeType === 'user_problem') where.userId = params.userId
  return where
}

export async function previewRejudgeTarget(where: any) {
  const [matchedCount, inProgressCount] = await Promise.all([
    prisma.submission.count({ where: { AND: [where, currentJudgeCompletedWhere()] } }),
    prisma.submission.count({ where: { AND: [where, currentJudgeInProgressWhere()] } }),
  ])
  return { matchedCount, inProgressCount }
}

export function listRejudgeCandidates(where: any) {
  return prisma.submission.findMany({ where, select: { id: true } })
}
