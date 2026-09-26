import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { isAcceptedResult } from '../../../lib/result-enum'
import {
  CURRENT_JUDGE_RUN_SELECT,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import {
  canAccessContest,
  canManageContest,
  getParticipantNames,
  requireContestStarted,
} from '../contest.helpers'
import { findContestForRanking } from '../../contest/contest-query.facade'
import { resolveOrganizationAuthorizationsForOrganization } from '../../authorization/capabilities'

export class ContestRankingError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new ContestRankingError(statusCode, code, message)
}

async function excludedManagerIds(contest: any) {
  if (contest.includeAdminInRanking) return []
  if (contest.teamId) {
    const members = await prisma.teamMember.findMany({
      where: { teamId: contest.teamId, status: 'active', role: { in: ['owner', 'admin'] } },
      select: { userId: true },
    })
    return members.map(member => member.userId)
  }
  if (!contest.organizationId) return []
  const [organizationAuthorizations, platformAdmins] = await Promise.all([
    resolveOrganizationAuthorizationsForOrganization(contest.organizationId),
    prisma.user.findMany({
      where: { role: { in: ['super_admin', 'platform_admin'] } },
      select: { id: true },
    }),
  ])
  return [...new Set([
    contest.createdBy,
    ...organizationAuthorizations.filter(item => item.capabilities.has('contest.manage')).map(item => item.userId),
    ...platformAdmins.map(user => user.id),
  ])]
}

function problemSummaries(problems: any[]) {
  return problems.map(problem => ({
    id: problem.id,
    alias: problem.alias,
    points: problem.points,
    orderIndex: problem.orderIndex,
  }))
}

type RankingRatingChange = {
  scope: string
  track: string
  organizationId: string | null
  organizationName: string | null
  ratingBefore: number
  ratingAfter: number
  appliedDelta: number
}

async function ratingChangesByUser(contestId: string): Promise<Map<string, RankingRatingChange[]>> {
  const batches = await prisma.ratingBatch.findMany({
    where: { contestId, status: 'APPLIED', supersededAt: null },
    select: {
      Pool: { select: { scopeType: true, track: true, organizationId: true, Organization: { select: { name: true, School: { select: { shortName: true } } } } } },
      Changes: { select: { userId: true, ratingBefore: true, ratingAfter: true, appliedDelta: true } },
    },
  })
  const result = new Map<string, RankingRatingChange[]>()
  for (const batch of batches) {
    for (const change of batch.Changes) {
      const values = result.get(change.userId) || []
      values.push({
        scope: batch.Pool.scopeType,
        track: batch.Pool.track,
        organizationId: batch.Pool.organizationId,
        organizationName: batch.Pool.Organization?.School?.shortName || batch.Pool.Organization?.name || null,
        ratingBefore: change.ratingBefore,
        ratingAfter: change.ratingAfter,
        appliedDelta: change.appliedDelta,
      })
      result.set(change.userId, values)
    }
  }
  return result
}

async function appendFinalizedRatingChanges(contest: any, contestId: string | null, payload: any) {
  if (contest.type !== 'contest' || contest.status !== 'finished' || payload.hidden) return payload
  if (!contestId) fail(409, 'CONTEST_CANONICAL_IDENTITY_MISSING', '比赛缺少规范身份，无法读取 Rating 变化')
  const byUser = await ratingChangesByUser(contestId)
  return {
    ...payload,
    ranking: payload.ranking.map((row: any) => ({ ...row, ratingChanges: byUser.get(row.userId) || [] })),
  }
}

async function buildOiRanking(contest: any, excludedIds: string[]) {
  const submitScope = contest.type === 'contest' ? 'contest' : 'contest'
  const adminFilter = excludedIds.length > 0
    ? Prisma.sql`AND p."userId" NOT IN (${Prisma.join(excludedIds)})`
    : Prisma.empty
  const activityFilter = contest.type === 'contest'
    ? Prisma.sql`AND s."canonicalContestId" = ${contest.canonicalContestId}`
    : Prisma.sql`AND s."contestId" = ${contest.id}`
  const aggregated = contest.format === 'oi'
    ? await prisma.$queryRaw<Array<{
      userId: string
      problemId: string
      maxScore: number
      lastSubmitAt: Date
    }>>`
      WITH projected AS (
        SELECT
          s.id,
          s."userId",
          s."problemId",
          s."createdAt",
          s."submissionPhase",
          CASE
            WHEN run.status = 'QUEUED' THEN 'queuing'
            WHEN run.status = 'RUNNING' THEN 'judging'
            WHEN run.status = 'CANCELLED' THEN COALESCE(run.result, 'judge_failed')
            WHEN run.status = 'FINALIZED' THEN COALESCE(run.result, 'unknown_error')
            ELSE 'system_error'
          END AS result,
          run.score AS score
        FROM "Submission" s
        JOIN "JudgeRun" run ON run.id = s."currentJudgeRunId"
        WHERE s."submitScope" = ${submitScope}
          ${activityFilter}
      ), selected AS (
        SELECT p.*, ROW_NUMBER() OVER (
          PARTITION BY p."userId", p."problemId"
          ORDER BY CASE WHEN p."submissionPhase" = 'FINAL' THEN 1 ELSE 0 END DESC,
                   p."createdAt" DESC, p.id DESC
        ) AS selected_order
        FROM projected p
        WHERE p.result NOT IN ('queuing', 'judging', 'pending_review') AND p.result <> ''
        ${adminFilter}
      )
      SELECT "userId", "problemId", COALESCE(score, 0) AS "maxScore", "createdAt" AS "lastSubmitAt"
      FROM selected
      WHERE selected_order = 1
    `
    : await prisma.$queryRaw<Array<{
    userId: string
    problemId: string
    maxScore: number
    lastSubmitAt: Date
  }>>`
    WITH projected AS (
      SELECT
        s."userId",
        s."problemId",
        s."createdAt",
        CASE
          WHEN run.status = 'QUEUED' THEN 'queuing'
          WHEN run.status = 'RUNNING' THEN 'judging'
          WHEN run.status = 'CANCELLED' THEN COALESCE(run.result, 'judge_failed')
          WHEN run.status = 'FINALIZED' THEN COALESCE(run.result, 'unknown_error')
          ELSE 'system_error'
        END AS result,
        run.score AS score
      FROM "Submission" s
      JOIN "JudgeRun" run ON run.id = s."currentJudgeRunId"
      WHERE s."submitScope" = ${submitScope}
        ${activityFilter}
    )
    SELECT
      p."userId",
      p."problemId",
      MAX(p.score) as "maxScore",
      MAX(p."createdAt") as "lastSubmitAt"
    FROM projected p
    WHERE p.result NOT IN ('queuing', 'judging', 'pending_review')
      AND p.result <> ''
      AND COALESCE(p.score, 0) = (
        SELECT MAX(COALESCE(p2.score, 0))
        FROM projected p2
        WHERE p2."userId" = p."userId"
          AND p2."problemId" = p."problemId"
          AND p2.result NOT IN ('queuing', 'judging', 'pending_review')
          AND p2.result <> ''
      )
      ${adminFilter}
    GROUP BY p."userId", p."problemId"
  `
  const userScores = new Map<string, Map<string, { maxScore: number; lastSubmitAt: Date }>>()
  for (const row of aggregated) {
    if (!userScores.has(row.userId)) userScores.set(row.userId, new Map())
    userScores.get(row.userId)!.set(row.problemId, {
      maxScore: Number(row.maxScore) || 0,
      lastSubmitAt: new Date(row.lastSubmitAt),
    })
  }
  const names = await getParticipantNames([...userScores.keys()], contest.organizationId || undefined)
  const ranking = Array.from(userScores.entries()).map(([userId, scores]) => {
    let totalScore = 0
    let lastSubmitAt = new Date(0)
    const problems: Record<string, { score: number; alias: string; submitted: boolean }> = {}
    for (const problem of contest.ContestProblem) {
      const score = scores.get(problem.Problem.problemId)
      const projectedScore = Math.round((score?.maxScore ?? 0) * (problem.points ?? 100)) / 100
      totalScore += projectedScore
      problems[problem.id] = {
        score: projectedScore,
        alias: problem.alias ?? '',
        submitted: Boolean(score),
      }
      if (score && score.lastSubmitAt > lastSubmitAt) lastSubmitAt = score.lastSubmitAt
    }
    return {
      userId,
      name: names.get(userId)?.name || '未知',
      username: names.get(userId)?.username || '',
      avatar: names.get(userId)?.avatar || null,
      userType: names.get(userId)?.userType || 'student',
      totalScore,
      lastSubmitAt: lastSubmitAt.toISOString(),
      problems,
    }
  })
  ranking.sort((left, right) => right.totalScore - left.totalScore ||
    new Date(left.lastSubmitAt).getTime() - new Date(right.lastSubmitAt).getTime())
  ranking.forEach((row, index) => {
    ;(row as typeof row & { rank: number }).rank = index > 0 && ranking[index - 1].totalScore === row.totalScore
      ? (ranking[index - 1] as typeof row & { rank: number }).rank
      : index + 1
  })
  return {
    format: contest.format,
    problems: problemSummaries(contest.ContestProblem),
    ranking,
  }
}

async function buildIcpcRanking(contest: any, excludedIds: string[]) {
  const submitScope = contest.type === 'contest' ? 'contest' : 'contest'
  const submissions = await prisma.submission.findMany({
    where: {
      submitScope,
      ...(contest.type === 'contest'
        ? { canonicalContestId: contest.canonicalContestId }
        : { contestId: contest.id }),
      ...(excludedIds.length > 0 ? { NOT: { userId: { in: excludedIds } } } : {}),
      currentJudgeRunId: { not: null },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, userId: true, problemId: true, createdAt: true,
      CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT },
    },
  })
  type ProblemStat = {
    solved: boolean
    penalty: number
    attempts: number
    acceptedAtMinutes: number | null
    submitted: boolean
  }
  const userStats = new Map<string, Map<string, ProblemStat>>()
  const firstAccepted = new Map<string, string>()
  const problemPoints = new Map<string, number>(contest.ContestProblem.map((problem: any): [string, number] => [
    problem.Problem.problemId,
    problem.points ?? 100,
  ]))
  for (const rawSubmission of submissions) {
    const submission = projectSubmissionJudgeResult(rawSubmission)
    if (!userStats.has(submission.userId)) userStats.set(submission.userId, new Map())
    const problemStats = userStats.get(submission.userId)!
    if (!problemStats.has(submission.problemId)) {
      problemStats.set(submission.problemId, {
        solved: false, penalty: 0, attempts: 0, acceptedAtMinutes: null, submitted: false,
      })
    }
    const stat = problemStats.get(submission.problemId)!
    if (stat.solved) continue
    stat.submitted = true
    if (['queuing', 'judging', 'pending_review'].includes(submission.result)) continue
    stat.attempts++
    if (isAcceptedResult(submission.result) || (submission.score ?? 0) >= (problemPoints.get(submission.problemId) ?? 100)) {
      stat.solved = true
      const minutes = (submission.createdAt.getTime() - contest.startTime.getTime()) / 60000
      stat.acceptedAtMinutes = Math.max(0, Math.floor(minutes))
      stat.penalty = minutes + (stat.attempts - 1) * 20
      if (!firstAccepted.has(submission.problemId)) firstAccepted.set(submission.problemId, submission.userId)
    }
  }
  const names = await getParticipantNames([...userStats.keys()], contest.organizationId || undefined)
  const ranking = Array.from(userStats.entries()).map(([userId, stats]) => {
    let solvedCount = 0
    let totalPenalty = 0
    const problems: Record<string, any> = {}
    for (const problem of contest.ContestProblem) {
      const key = problem.Problem.problemId
      const stat = stats.get(key)
      const solved = stat?.solved ?? false
      if (solved) {
        solvedCount++
        totalPenalty += stat?.penalty ?? 0
      }
      problems[problem.id] = {
        solved,
        penalty: stat?.penalty ?? 0,
        attempts: stat?.attempts ?? 0,
        acceptedAtMinutes: stat?.acceptedAtMinutes ?? null,
        alias: problem.alias ?? '',
        isFirstAccepted: solved && firstAccepted.get(key) === userId,
        submitted: stat?.submitted ?? false,
      }
    }
    return {
      userId,
      name: names.get(userId)?.name || '未知',
      username: names.get(userId)?.username || '',
      avatar: names.get(userId)?.avatar || null,
      userType: names.get(userId)?.userType || 'student',
      solvedCount,
      totalPenalty: Math.round(totalPenalty),
      problems,
    }
  })
  ranking.sort((left, right) => right.solvedCount - left.solvedCount || left.totalPenalty - right.totalPenalty)
  ranking.forEach((row, index) => {
    ;(row as typeof row & { rank: number }).rank = index > 0 &&
      ranking[index - 1].solvedCount === row.solvedCount && ranking[index - 1].totalPenalty === row.totalPenalty
      ? (ranking[index - 1] as typeof row & { rank: number }).rank
      : index + 1
  })
  return { format: 'icpc', problems: problemSummaries(contest.ContestProblem), ranking }
}

export async function getContestRanking(contestId: number, userId: string) {
  const resolved = await findContestForRanking(contestId)
  if (!resolved) fail(404, 'TRAINING_NOT_FOUND', '训练不存在')
  const contest = resolved.contest
  if (!await canAccessContest(userId, contest)) fail(403, 'TRAINING_ACCESS_DENIED', '无权限')
  const notStarted = await requireContestStarted(contest, userId)
  if (notStarted) fail(403, 'TRAINING_NOT_STARTED', notStarted)
  const isAdmin = await canManageContest(userId, contest)
  if (contest.type === 'homework' && !isAdmin) {
    fail(403, 'HOMEWORK_RANKING_HIDDEN', '只有管理员可以查看作业排名')
  }
  const now = Date.now()
  const status = contest.status === 'finished'
    ? 'finished'
    : contest.status === 'ongoing' || now >= contest.startTime.getTime() && now <= contest.endTime.getTime()
      ? 'ongoing'
      : 'upcoming'
  if (contest.format === 'oi' && status !== 'finished' && !isAdmin) {
    return { format: 'oi', problems: [], ranking: [], hidden: true }
  }
  const excludedIds = await excludedManagerIds(contest)
  const payload = contest.format === 'ioi' || contest.format === 'oi'
    ? await buildOiRanking(contest, excludedIds)
    : await buildIcpcRanking(contest, excludedIds)
  return appendFinalizedRatingChanges(contest, resolved.canonical?.id || null, payload)
}
