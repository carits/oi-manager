import type { RatingParticipantDisposition, RatingTrack } from '@prisma/client'
import { isAcceptedResult } from '../../../lib/result-enum'

export interface ScoringProblem {
  id: string
  points: number | null
}

export interface ScoringSubmission {
  id: number
  userId: string
  trainingProblemId: string | null
  result: string
  score: number | null
  createdAt: Date
  submissionPhase: string | null
}

export interface ScoringParticipant {
  userId: string
  organizationIdSnapshot: string | null
  disposition: RatingParticipantDisposition
  ratingLocked: boolean
}

export interface StandingDraftEntry {
  userId: string
  organizationIdSnapshot: string | null
  rank: number
  ratingTieGroup: string
  totalScore: number | null
  solvedCount: number | null
  penaltySeconds: number | null
  lastAcceptedAt: Date | null
  fullScoreCount: number | null
  ratingEligible: boolean
  participantDisposition: RatingParticipantDisposition
}

export type ScoreProblemPolicy = 'LAST_SUBMISSION' | 'BEST_SUBMISSION'
export type ScoreTiePolicy = 'SCORE' | 'SCORE_FULL_COUNT'

export type ContestScoringRules = {
  version: 1 | 2
  problemPolicy?: ScoreProblemPolicy
  tiePolicy?: ScoreTiePolicy
  judgeMaxScore?: number
  wrongPenaltySeconds?: number
  penaltyVerdicts?: string[]
  compileErrorPenalty?: boolean
  leaderboardTiePolicy?: 'SOLVED_PENALTY' | 'SOLVED_PENALTY_LAST_ACCEPTED'
  ratingTiePolicy?: 'SOLVED_PENALTY' | 'SOLVED_PENALTY_LAST_ACCEPTED'
}

export function defaultScoringRules(track: RatingTrack): ContestScoringRules {
  if (track === 'OI') return { version: 2, problemPolicy: 'LAST_SUBMISSION', tiePolicy: 'SCORE', judgeMaxScore: 100 }
  if (track === 'IOI') return { version: 2, problemPolicy: 'BEST_SUBMISSION', tiePolicy: 'SCORE', judgeMaxScore: 100 }
  return {
    version: 2,
    wrongPenaltySeconds: 1200,
    penaltyVerdicts: ['WA', 'PE', 'TLE', 'MLE', 'RE', 'OLE'],
    compileErrorPenalty: false,
    leaderboardTiePolicy: 'SOLVED_PENALTY_LAST_ACCEPTED',
    ratingTiePolicy: 'SOLVED_PENALTY',
  }
}

export function normalizeScoringRules(track: RatingTrack, value: unknown): ContestScoringRules {
  const defaults = defaultScoringRules(track)
  if (!value || typeof value !== 'object') return defaults
  const raw = value as any
  const version = Number(raw.version ?? 1)
  if (version !== 1 && version !== 2) return defaults
  if (track === 'ACM') {
    const wrongPenaltySeconds = Number(raw.wrongPenaltySeconds)
    const legacyTiePolicy = raw.ratingTiePolicy === 'SOLVED_PENALTY' ? 'SOLVED_PENALTY' : 'SOLVED_PENALTY_LAST_ACCEPTED'
    return {
      version,
      wrongPenaltySeconds: Number.isInteger(wrongPenaltySeconds) && wrongPenaltySeconds >= 0 && wrongPenaltySeconds <= 24 * 60 * 60 ? wrongPenaltySeconds : defaults.wrongPenaltySeconds,
      penaltyVerdicts: Array.isArray(raw.penaltyVerdicts) ? raw.penaltyVerdicts.map((item: unknown) => String(item).toUpperCase()).filter(Boolean).slice(0, 32) : defaults.penaltyVerdicts,
      compileErrorPenalty: raw.compileErrorPenalty === true,
      leaderboardTiePolicy: version === 1
        ? legacyTiePolicy
        : raw.leaderboardTiePolicy === 'SOLVED_PENALTY' ? 'SOLVED_PENALTY' : 'SOLVED_PENALTY_LAST_ACCEPTED',
      ratingTiePolicy: version === 1
        ? legacyTiePolicy
        : raw.ratingTiePolicy === 'SOLVED_PENALTY_LAST_ACCEPTED' ? 'SOLVED_PENALTY_LAST_ACCEPTED' : 'SOLVED_PENALTY',
    }
  }
  const judgeMaxScore = Number(raw.judgeMaxScore)
  return {
    version,
    problemPolicy: raw.problemPolicy === 'BEST_SUBMISSION' || raw.problemPolicy === 'LAST_SUBMISSION'
      ? raw.problemPolicy
      : defaults.problemPolicy,
    tiePolicy: raw.tiePolicy === 'SCORE_FULL_COUNT' || raw.tiePolicy === 'SCORE'
      ? raw.tiePolicy
      : defaults.tiePolicy,
    judgeMaxScore: Number.isFinite(judgeMaxScore) && judgeMaxScore > 0 ? judgeMaxScore : defaults.judgeMaxScore,
  }
}

const PENDING_RESULTS = new Set(['', 'queuing', 'judging', 'pending_review'])

function verdictAliases(verdict: string) {
  const key = verdict.toUpperCase()
  const aliases: Record<string, string[]> = {
    WA: ['wrong_answer', 'wa'], PE: ['presentation_error', 'pe'],
    TLE: ['time_limit_exceeded', 'tle'], MLE: ['memory_limit_exceeded', 'mle'],
    RE: ['runtime_error', 're'], OLE: ['output_limit_exceeded', 'ole'],
    CE: ['compile_error', 'ce'],
  }
  return aliases[key] || [verdict.toLowerCase()]
}

function scaledScore(submission: ScoringSubmission, problem: ScoringProblem, judgeMaxScore: number) {
  const raw = Math.max(0, Math.min(judgeMaxScore, submission.score ?? (isAcceptedResult(submission.result) ? judgeMaxScore : 0)))
  return Math.round((raw / judgeMaxScore) * (problem.points ?? 100) * 100) / 100
}

function competitionRanks<T>(items: T[], tied: (left: T, right: T) => boolean) {
  const ranks: number[] = []
  for (let index = 0; index < items.length; index++) ranks.push(index > 0 && tied(items[index - 1], items[index]) ? ranks[index - 1] : index + 1)
  return ranks
}

function scoreBasedStanding(
  rules: ContestScoringRules,
  problems: ScoringProblem[],
  submissions: ScoringSubmission[],
  participants: ScoringParticipant[],
) {
  const rows = participants.map(participant => {
    let totalScore = 0
    let fullScoreCount = 0
    for (const problem of problems) {
      const attempts = submissions.filter(item => item.userId === participant.userId && item.trainingProblemId === problem.id && !PENDING_RESULTS.has(item.result))
      if (!attempts.length) continue
      const judgeMaxScore = rules.judgeMaxScore || 100
      const selected = rules.problemPolicy === 'BEST_SUBMISSION'
        ? [...attempts].sort((left, right) => scaledScore(right, problem, judgeMaxScore) - scaledScore(left, problem, judgeMaxScore) || right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id)[0]
        : [...attempts].sort((left, right) => Number(right.submissionPhase === 'FINAL') - Number(left.submissionPhase === 'FINAL') || right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id)[0]
      const score = scaledScore(selected, problem, judgeMaxScore)
      totalScore += score
      if (score >= (problem.points ?? 100)) fullScoreCount++
    }
    return { participant, totalScore: Math.round(totalScore * 100) / 100, fullScoreCount }
  }).sort((left, right) => right.totalScore - left.totalScore || (rules.tiePolicy === 'SCORE_FULL_COUNT' ? right.fullScoreCount - left.fullScoreCount : 0) || left.participant.userId.localeCompare(right.participant.userId))
  const ranks = competitionRanks(rows, (left, right) => left.totalScore === right.totalScore && (rules.tiePolicy !== 'SCORE_FULL_COUNT' || left.fullScoreCount === right.fullScoreCount))
  return rows.map((row, index): StandingDraftEntry => ({
    userId: row.participant.userId,
    organizationIdSnapshot: row.participant.organizationIdSnapshot,
    rank: ranks[index],
    ratingTieGroup: rules.tiePolicy === 'SCORE_FULL_COUNT' ? `score:${row.totalScore.toFixed(2)}:full:${row.fullScoreCount}` : `score:${row.totalScore.toFixed(2)}`,
    totalScore: row.totalScore,
    solvedCount: null,
    penaltySeconds: null,
    lastAcceptedAt: null,
    fullScoreCount: row.fullScoreCount,
    ratingEligible: row.participant.ratingLocked && !['EXCLUDE', 'KEEP_RESULT'].includes(row.participant.disposition),
    participantDisposition: row.participant.disposition,
  }))
}

function acmStanding(
  startTime: Date,
  rules: ContestScoringRules,
  problems: ScoringProblem[],
  submissions: ScoringSubmission[],
  participants: ScoringParticipant[],
) {
  const penaltyResults = new Set((rules.penaltyVerdicts || []).flatMap(verdict => verdictAliases(verdict)))
  const rows = participants.map(participant => {
    let solvedCount = 0
    let penaltySeconds = 0
    let lastAcceptedAt: Date | null = null
    for (const problem of problems) {
      const attempts = submissions.filter(item => item.userId === participant.userId && item.trainingProblemId === problem.id && !PENDING_RESULTS.has(item.result))
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id - right.id)
      let wrong = 0
      for (const attempt of attempts) {
        if (isAcceptedResult(attempt.result) || (attempt.score ?? 0) >= 100) {
          solvedCount++
          penaltySeconds += Math.max(0, Math.floor((attempt.createdAt.getTime() - startTime.getTime()) / 1000)) + wrong * (rules.wrongPenaltySeconds ?? 1200)
          if (!lastAcceptedAt || attempt.createdAt > lastAcceptedAt) lastAcceptedAt = attempt.createdAt
          break
        }
        if (penaltyResults.has(attempt.result.toLowerCase()) || rules.compileErrorPenalty && ['compile_error', 'ce'].includes(attempt.result.toLowerCase())) wrong++
      }
    }
    return { participant, solvedCount, penaltySeconds, lastAcceptedAt }
  }).sort((left, right) => right.solvedCount - left.solvedCount || left.penaltySeconds - right.penaltySeconds ||
    (rules.leaderboardTiePolicy === 'SOLVED_PENALTY_LAST_ACCEPTED' ? (left.lastAcceptedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.lastAcceptedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) : 0) || left.participant.userId.localeCompare(right.participant.userId))
  const ranks = competitionRanks(rows, (left, right) => left.solvedCount === right.solvedCount && left.penaltySeconds === right.penaltySeconds && (rules.leaderboardTiePolicy !== 'SOLVED_PENALTY_LAST_ACCEPTED' || left.lastAcceptedAt?.getTime() === right.lastAcceptedAt?.getTime()))
  return rows.map((row, index): StandingDraftEntry & { leaderboardTieGroup: string } => ({
    userId: row.participant.userId,
    organizationIdSnapshot: row.participant.organizationIdSnapshot,
    rank: ranks[index],
    ratingTieGroup: rules.ratingTiePolicy === 'SOLVED_PENALTY_LAST_ACCEPTED'
      ? `ac:${row.solvedCount}:penalty:${row.penaltySeconds}:last:${row.lastAcceptedAt?.getTime() ?? 'none'}`
      : `ac:${row.solvedCount}:penalty:${row.penaltySeconds}`,
    leaderboardTieGroup: rules.leaderboardTiePolicy === 'SOLVED_PENALTY_LAST_ACCEPTED'
      ? `ac:${row.solvedCount}:penalty:${row.penaltySeconds}:last:${row.lastAcceptedAt?.getTime() ?? 'none'}`
      : `ac:${row.solvedCount}:penalty:${row.penaltySeconds}`,
    totalScore: null,
    solvedCount: row.solvedCount,
    penaltySeconds: row.penaltySeconds,
    lastAcceptedAt: row.lastAcceptedAt,
    fullScoreCount: null,
    ratingEligible: row.participant.ratingLocked && !['EXCLUDE', 'KEEP_RESULT'].includes(row.participant.disposition),
    participantDisposition: row.participant.disposition,
  }))
}

export function buildStanding(input: {
  track: RatingTrack
  startTime: Date
  problems: ScoringProblem[]
  submissions: ScoringSubmission[]
  participants: ScoringParticipant[]
  scoringRules?: unknown
}) {
  const visibleParticipants = input.participants.filter(item => item.disposition !== 'EXCLUDE')
  const rules = normalizeScoringRules(input.track, input.scoringRules)
  const rows = input.track === 'ACM'
    ? acmStanding(input.startTime, rules, input.problems, input.submissions, visibleParticipants)
    : scoreBasedStanding(rules, input.problems, input.submissions, visibleParticipants)
  const normal = rows.filter(item => item.participantDisposition !== 'FORCE_LAST')
  const forcedLast = rows.filter(item => item.participantDisposition === 'FORCE_LAST')
  const leaderboardTieGroupOf = (item: StandingDraftEntry) =>
    (item as StandingDraftEntry & { leaderboardTieGroup?: string }).leaderboardTieGroup ?? item.ratingTieGroup
  normal.forEach((item, index) => {
    const tieGroup = leaderboardTieGroupOf(item)
    const previousTieGroup = index > 0 ? leaderboardTieGroupOf(normal[index - 1]) : null
    item.rank = index > 0 && tieGroup === previousTieGroup
      ? normal[index - 1].rank
      : index + 1
  })
  forcedLast.forEach(item => {
    item.rank = normal.length + 1
    item.ratingTieGroup = 'disposition:forced-last'
  })
  return [...normal, ...forcedLast].map(item => {
    const internal = item as StandingDraftEntry & { leaderboardTieGroup?: string }
    if (!internal.leaderboardTieGroup) return item
    const { leaderboardTieGroup: _leaderboardTieGroup, ...standing } = internal
    return standing
  })
}
