import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { isAcceptedResult } from '../../../lib/result-enum'
import {
  CURRENT_JUDGE_RUN_SELECT,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import {
  canAccessTraining,
  canManageTraining,
  getParticipantNames,
  requireTrainingStarted,
} from '../training.helpers'
import { findActivityRuntimeForRanking } from '../../contest/contest-query.facade'
import { resolveOrganizationAuthorizationsForOrganization } from '../../authorization/capabilities'

export class TrainingRankingError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new TrainingRankingError(statusCode, code, message)
}

async function excludedManagerIds(training: any) {
  if (training.includeAdminInRanking) return []
  if (training.teamId) {
    const members = await prisma.teamMember.findMany({
      where: { teamId: training.teamId, status: 'active', role: { in: ['owner', 'admin'] } },
      select: { userId: true },
    })
    return members.map(member => member.userId)
  }
  if (!training.organizationId) return []
  const [organizationAuthorizations, platformAdmins] = await Promise.all([
    resolveOrganizationAuthorizationsForOrganization(training.organizationId),
    prisma.user.findMany({
      where: { role: { in: ['super_admin', 'platform_admin'] } },
      select: { id: true },
    }),
  ])
  return [...new Set([
    training.createdBy,
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

async function ratingChangesByUser(trainingId: number): Promise<Map<string, RankingRatingChange[]>> {
  const batches = await prisma.ratingBatch.findMany({
    where: { trainingId, status: 'APPLIED', supersededAt: null },
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

async function appendFinalizedRatingChanges(training: any, payload: any) {
  if (training.type !== 'contest' || training.status !== 'finished' || payload.hidden) return payload
  const byUser = await ratingChangesByUser(training.id)
  return {
    ...payload,
    ranking: payload.ranking.map((row: any) => ({ ...row, ratingChanges: byUser.get(row.userId) || [] })),
  }
}

async function buildOiRanking(training: any, excludedIds: string[]) {
  const submitScope = training.type === 'contest' ? 'contest' : 'training'
  const adminFilter = excludedIds.length > 0
    ? Prisma.sql`AND p."userId" NOT IN (${Prisma.join(excludedIds)})`
    : Prisma.empty
  const aggregated = training.format === 'oi'
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
            ELSE s.result
          END AS result,
          CASE WHEN s."currentJudgeRunId" IS NOT NULL THEN run.score ELSE s.score END AS score
        FROM "Submission" s
        LEFT JOIN "JudgeRun" run ON run.id = s."currentJudgeRunId"
        WHERE s."submitScope" = ${submitScope}
          AND s."trainingId" = ${training.id}
          AND COALESCE(s."submitMethod", '') <> 'archive'
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
          ELSE s.result
        END AS result,
        CASE WHEN s."currentJudgeRunId" IS NOT NULL THEN run.score ELSE s.score END AS score
      FROM "Submission" s
      LEFT JOIN "JudgeRun" run ON run.id = s."currentJudgeRunId"
      WHERE s."submitScope" = ${submitScope}
        AND s."trainingId" = ${training.id}
        AND COALESCE(s."submitMethod", '') <> 'archive'
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
  const names = await getParticipantNames([...userScores.keys()], training.organizationId || undefined)
  const ranking = Array.from(userScores.entries()).map(([userId, scores]) => {
    let totalScore = 0
    let lastSubmitAt = new Date(0)
    const problems: Record<string, { score: number; alias: string; submitted: boolean }> = {}
    for (const problem of training.TrainingProblem) {
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
    format: training.format,
    problems: problemSummaries(training.TrainingProblem),
    ranking,
  }
}

async function buildIcpcRanking(training: any, excludedIds: string[]) {
  const submitScope = training.type === 'contest' ? 'contest' : 'training'
  const submissions = await prisma.submission.findMany({
    where: {
      submitScope,
      trainingId: training.id,
      ...(excludedIds.length > 0 ? { NOT: { userId: { in: excludedIds } } } : {}),
      submitMethod: { not: 'archive' },
      OR: [
        { currentJudgeRunId: { not: null } },
        { currentJudgeRunId: null, result: { not: '' } },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, userId: true, problemId: true, score: true, result: true, createdAt: true,
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
  const problemPoints = new Map<string, number>(training.TrainingProblem.map((problem: any): [string, number] => [
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
      const minutes = (submission.createdAt.getTime() - training.startTime.getTime()) / 60000
      stat.acceptedAtMinutes = Math.max(0, Math.floor(minutes))
      stat.penalty = minutes + (stat.attempts - 1) * 20
      if (!firstAccepted.has(submission.problemId)) firstAccepted.set(submission.problemId, submission.userId)
    }
  }
  const names = await getParticipantNames([...userStats.keys()], training.organizationId || undefined)
  const ranking = Array.from(userStats.entries()).map(([userId, stats]) => {
    let solvedCount = 0
    let totalPenalty = 0
    const problems: Record<string, any> = {}
    for (const problem of training.TrainingProblem) {
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
  return { format: 'icpc', problems: problemSummaries(training.TrainingProblem), ranking }
}

export async function getTrainingRanking(trainingId: number, userId: string) {
  const resolved = await findActivityRuntimeForRanking(trainingId)
  if (!resolved) fail(404, 'TRAINING_NOT_FOUND', '训练不存在')
  const training = resolved.runtime
  if (!await canAccessTraining(userId, training)) fail(403, 'TRAINING_ACCESS_DENIED', '无权限')
  const notStarted = await requireTrainingStarted(training, userId)
  if (notStarted) fail(403, 'TRAINING_NOT_STARTED', notStarted)
  const isAdmin = await canManageTraining(userId, training)
  if (training.type === 'homework' && !isAdmin) {
    fail(403, 'HOMEWORK_RANKING_HIDDEN', '只有管理员可以查看作业排名')
  }
  const now = Date.now()
  const status = training.status === 'finished'
    ? 'finished'
    : training.status === 'ongoing' || now >= training.startTime.getTime() && now <= training.endTime.getTime()
      ? 'ongoing'
      : 'upcoming'
  if (training.format === 'oi' && status !== 'finished' && !isAdmin) {
    return { format: 'oi', problems: [], ranking: [], hidden: true }
  }
  const excludedIds = await excludedManagerIds(training)
  const payload = training.format === 'ioi' || training.format === 'oi'
    ? await buildOiRanking(training, excludedIds)
    : await buildIcpcRanking(training, excludedIds)
  return appendFinalizedRatingChanges(training, payload)
}
