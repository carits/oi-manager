import { prisma } from '../../../prisma'
import {
  CURRENT_JUDGE_RUN_SELECT,
  currentJudgeCompletedWhere,
  currentJudgeInProgressWhere,
  currentJudgeResultWhere,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import { contestProblemAsActivity } from '../../contest/contest-activity-projection'

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

export async function loadTrainingProblemForSubmission(trainingId: number, trainingProblemId: string) {
  const contest = await findContest(trainingId)
  if (contest) {
    const row = await prisma.contestProblem.findFirst({
      where: { id: trainingProblemId, contestId: contest.id },
      include: {
        TestSetRevision: true,
        ContestResource: true,
        CanonicalProblem: { include: { LatestTestSetRevision: true } },
      },
    })
    return row ? contestProblemAsActivity(row, contest.publicId) : null
  }
  return prisma.trainingProblem.findFirst({
    where: { id: trainingProblemId, trainingId },
    include: { TestSetRevision: true, Problem: { include: { LatestTestSetRevision: true } } },
  })
}

export function countProblemTestdata(problemId: string) {
  return prisma.testdataFile.count({ where: { problemId } })
}

export async function queryTrainingSubmissions(params: {
  training: any
  requesterId: string
  isAdmin: boolean
  filters: { userId?: string; problemId?: string; username?: string; result?: string; language?: string }
  pagination: { skip: number; pageSize: number }
}) {
  const { training, requesterId, isAdmin, filters, pagination } = params
  const isContest = training.type === 'contest'
  const where: any = {
    submitScope: isContest ? 'contest' : 'training',
    ...(isContest
      ? { canonicalContestId: training.canonicalContestId }
      : { trainingId: training.id }),
    currentJudgeRunId: { not: null },
    AND: [],
  }
  if (filters.userId) where.userId = filters.userId
  if (filters.problemId) {
    if (isContest) {
      const contestProblem = await prisma.contestProblem.findFirst({
        where: { id: filters.problemId, contestId: training.canonicalContestId },
        select: { id: true, problemId: true, CanonicalProblem: { select: { problemId: true } } },
      })
      where.problemId = contestProblem?.problemId || contestProblem?.CanonicalProblem?.problemId || filters.problemId
    } else {
      const trainingProblem = await prisma.trainingProblem.findFirst({
        where: { id: filters.problemId, trainingId: training.id },
        select: { Problem: { select: { problemId: true } } },
      })
      where.problemId = trainingProblem?.Problem.problemId ?? filters.problemId
    }
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
  const trainingProblemsPromise = isContest
    ? prisma.contestProblem.findMany({
        where: { contestId: training.canonicalContestId },
        select: {
          id: true, canonicalProblemId: true, alias: true, orderIndex: true,
          CanonicalProblem: { select: { problemId: true, judgeConfig: true } },
        },
      }).then(rows => rows.map(row => ({
        id: row.id,
        problemId: row.canonicalProblemId,
        alias: row.alias,
        orderIndex: row.orderIndex,
        judgeConfigSnapshot: null,
        Problem: row.CanonicalProblem,
      })))
    : prisma.trainingProblem.findMany({
        where: { trainingId: training.id },
        select: {
          id: true, problemId: true, alias: true, orderIndex: true, judgeConfigSnapshot: true,
          Problem: { select: { problemId: true, judgeConfig: true } },
        },
      })
  const [rawSubmissions, total, trainingProblems] = await Promise.all([
    prisma.submission.findMany({
      where,
      include: { CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT } },
      orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.pageSize,
    }),
    prisma.submission.count({ where }),
    trainingProblemsPromise,
  ])
  const submissions = rawSubmissions.map(projectSubmissionJudgeResult)
  const userIds = [...new Set(submissions.map(submission => submission.userId))]
  const [users, memberships] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }),
    training.organizationId ? prisma.organizationMembership.findMany({
      where: { organizationId: training.organizationId, userId: { in: userIds }, status: 'active' },
      select: {
        userId: true, memberRole: true,
        StudentProfile: { select: { name: true } }, TeacherProfile: { select: { name: true } },
      },
    }) : Promise.resolve([]),
  ])
  return { empty: false as const, submissions, total, trainingProblems, users, memberships }
}

export async function loadTrainingSubmissionDetail(trainingId: number, submissionId: number, submitScope: string) {
  const contest = submitScope === 'contest' ? await findContest(trainingId) : null
  const submission = await prisma.submission.findFirst({
    where: {
      id: submissionId,
      submitScope,
      ...(contest ? { canonicalContestId: contest.id } : { trainingId }),
    },
    include: { CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT } },
  })
  if (!submission) return null
  const projectedSubmission = projectSubmissionJudgeResult(submission)
  const trainingProblemPromise = contest
    ? prisma.contestProblem.findFirst({
        where: {
          contestId: contest.id,
          OR: [
            ...(projectedSubmission.canonicalContestProblemId ? [{ id: projectedSubmission.canonicalContestProblemId }] : []),
            { problemId: projectedSubmission.problemId },
            { CanonicalProblem: { problemId: projectedSubmission.problemId } },
          ],
        },
        include: { CanonicalProblem: { select: { platform: true, judgeConfig: true } } },
      }).then(row => row ? {
        ...row,
        Problem: row.CanonicalProblem,
        judgeConfigSnapshot: null,
      } : null)
    : projectedSubmission.trainingProblemId
      ? prisma.trainingProblem.findFirst({
          where: { id: projectedSubmission.trainingProblemId, trainingId },
          include: { Problem: { select: { platform: true, judgeConfig: true } } },
        })
      : prisma.trainingProblem.findFirst({
          where: {
            trainingId,
            OR: [{ problemId: projectedSubmission.problemId }, { Problem: { problemId: projectedSubmission.problemId } }],
          },
          include: { Problem: { select: { platform: true, judgeConfig: true } } },
        })
  const [trainingProblem, submitter] = await Promise.all([
    trainingProblemPromise,
    prisma.user.findUnique({ where: { id: projectedSubmission.userId }, select: { username: true } }),
  ])
  return { submission: projectedSubmission, trainingProblem, submitter }
}

export async function listTrainingSubmissionUsers(trainingId: number) {
  const contest = await findContest(trainingId)
  return prisma.user.findMany({
    where: {
      Submission: {
        some: {
          ...(contest ? { canonicalContestId: contest.id } : { trainingId }),
          ...localJudgeSubmissionWhere(),
        },
      },
    },
    select: { id: true, username: true }, orderBy: { username: 'asc' },
  })
}

export async function buildRejudgeTarget(params: {
  training: any
  scopeType: string
  trainingProblemId?: string
  userId?: string
}) {
  const isContest = params.training.type === 'contest'
  const where: any = {
    ...(isContest
      ? { canonicalContestId: params.training.canonicalContestId }
      : { trainingId: params.training.id }),
    submitScope: isContest ? 'contest' : 'training',
    AND: [localJudgeSubmissionWhere()],
  }
  if (params.scopeType === 'problem' || params.scopeType === 'user_problem') {
    if (isContest) {
      const problem = await prisma.contestProblem.findFirst({
        where: { id: params.trainingProblemId, contestId: params.training.canonicalContestId },
        select: { id: true, problemId: true, CanonicalProblem: { select: { problemId: true } } },
      })
      if (!problem) return null
      where.AND.push({
        OR: [
          { canonicalContestProblemId: problem.id },
          { problemId: problem.problemId || problem.CanonicalProblem?.problemId || '' },
        ],
      })
    } else {
      const problem = await prisma.trainingProblem.findFirst({
        where: { id: params.trainingProblemId, trainingId: params.training.id },
        select: { id: true, Problem: { select: { problemId: true } } },
      })
      if (!problem) return null
      where.AND.push({ OR: [{ trainingProblemId: problem.id }, { problemId: problem.Problem.problemId }] })
    }
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
