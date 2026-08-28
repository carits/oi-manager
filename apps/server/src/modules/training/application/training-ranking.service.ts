import { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { isAcceptedResult } from '../../../lib/result-enum'
import {
  canAccessTraining,
  canManageTraining,
  getParticipantNames,
  requireTrainingStarted,
} from '../training.helpers'

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
  const [organizationAdmins, platformAdmins] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: {
        organizationId: training.organizationId,
        status: 'active',
        memberRole: 'school_principal',
      },
      select: { userId: true },
    }),
    prisma.user.findMany({
      where: { role: { in: ['super_admin', 'platform_admin'] } },
      select: { id: true },
    }),
  ])
  return [...new Set([
    training.createdBy,
    ...organizationAdmins.map(member => member.userId),
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

async function buildOiRanking(training: any, excludedIds: string[]) {
  const submitScope = training.type === 'contest' ? 'contest' : 'training'
  const adminFilter = excludedIds.length > 0
    ? Prisma.sql`AND "userId" NOT IN (${Prisma.join(excludedIds)})`
    : Prisma.empty
  const aggregated = await prisma.$queryRaw<Array<{
    userId: string
    problemId: string
    maxScore: number
    lastSubmitAt: Date
  }>>`
    SELECT
      "userId",
      "problemId",
      MAX(score) as "maxScore",
      MAX("createdAt") as "lastSubmitAt"
    FROM "Submission"
    WHERE "submitScope" = ${submitScope}
      AND "trainingId" = ${training.id}
      AND COALESCE("submitMethod", '') <> 'archive'
      AND result NOT IN ('queuing', 'judging', 'pending_review')
      AND result <> ''
      AND COALESCE(score, 0) = (
        SELECT MAX(COALESCE(s2.score, 0)) FROM "Submission" s2
        WHERE s2."userId" = "Submission"."userId"
          AND s2."problemId" = "Submission"."problemId"
          AND s2."submitScope" = ${submitScope}
          AND s2."trainingId" = ${training.id}
          AND COALESCE(s2."submitMethod", '') <> 'archive'
          AND s2.result NOT IN ('queuing', 'judging', 'pending_review')
          AND s2.result <> ''
      )
      ${adminFilter}
    GROUP BY "userId", "problemId"
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
      totalScore += score?.maxScore ?? 0
      problems[problem.id] = {
        score: score?.maxScore ?? 0,
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
      result: { not: '' },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, userId: true, problemId: true, score: true, result: true, createdAt: true },
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
  for (const submission of submissions) {
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
  return { format: 'icpc', problems: problemSummaries(training.TrainingProblem), ranking }
}

export async function getTrainingRanking(trainingId: number, userId: string) {
  const training = await prisma.training.findUnique({
    where: { id: trainingId },
    include: {
      TrainingProblem: {
        orderBy: { orderIndex: 'asc' },
        select: {
          id: true, problemId: true, alias: true, points: true, orderIndex: true,
          Problem: { select: { problemId: true } },
        },
      },
    },
  })
  if (!training) fail(404, 'TRAINING_NOT_FOUND', '训练不存在')
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
  return training.format === 'ioi' || training.format === 'oi'
    ? buildOiRanking(training, excludedIds)
    : buildIcpcRanking(training, excludedIds)
}
