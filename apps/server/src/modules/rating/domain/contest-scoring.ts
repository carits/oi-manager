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

const PENDING_RESULTS = new Set(['', 'queuing', 'judging', 'pending_review'])
const PENALTY_RESULTS = new Set(['wrong_answer', 'wa', 'time_limit_exceeded', 'tle', 'memory_limit_exceeded', 'mle', 'runtime_error', 're', 'output_limit_exceeded', 'ole', 'presentation_error', 'pe'])

function scaledScore(submission: ScoringSubmission, problem: ScoringProblem) {
  const raw = Math.max(0, Math.min(100, submission.score ?? (isAcceptedResult(submission.result) ? 100 : 0)))
  return Math.round(raw * (problem.points ?? 100)) / 100
}

function competitionRanks<T>(items: T[], tied: (left: T, right: T) => boolean) {
  const ranks: number[] = []
  for (let index = 0; index < items.length; index++) ranks.push(index > 0 && tied(items[index - 1], items[index]) ? ranks[index - 1] : index + 1)
  return ranks
}

function scoreBasedStanding(
  track: Extract<RatingTrack, 'OI' | 'IOI'>,
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
      const selected = track === 'IOI'
        ? [...attempts].sort((left, right) => scaledScore(right, problem) - scaledScore(left, problem) || right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id)[0]
        : [...attempts].sort((left, right) => Number(right.submissionPhase === 'FINAL') - Number(left.submissionPhase === 'FINAL') || right.createdAt.getTime() - left.createdAt.getTime() || right.id - left.id)[0]
      const score = scaledScore(selected, problem)
      totalScore += score
      if (score >= (problem.points ?? 100)) fullScoreCount++
    }
    return { participant, totalScore: Math.round(totalScore * 100) / 100, fullScoreCount }
  }).sort((left, right) => right.totalScore - left.totalScore || left.participant.userId.localeCompare(right.participant.userId))
  const ranks = competitionRanks(rows, (left, right) => left.totalScore === right.totalScore)
  return rows.map((row, index): StandingDraftEntry => ({
    userId: row.participant.userId,
    organizationIdSnapshot: row.participant.organizationIdSnapshot,
    rank: ranks[index],
    ratingTieGroup: `score:${row.totalScore.toFixed(2)}`,
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
  problems: ScoringProblem[],
  submissions: ScoringSubmission[],
  participants: ScoringParticipant[],
) {
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
          penaltySeconds += Math.max(0, Math.floor((attempt.createdAt.getTime() - startTime.getTime()) / 1000)) + wrong * 20 * 60
          if (!lastAcceptedAt || attempt.createdAt > lastAcceptedAt) lastAcceptedAt = attempt.createdAt
          break
        }
        if (PENALTY_RESULTS.has(attempt.result.toLowerCase())) wrong++
      }
    }
    return { participant, solvedCount, penaltySeconds, lastAcceptedAt }
  }).sort((left, right) => right.solvedCount - left.solvedCount || left.penaltySeconds - right.penaltySeconds ||
    (left.lastAcceptedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.lastAcceptedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) || left.participant.userId.localeCompare(right.participant.userId))
  const ranks = competitionRanks(rows, (left, right) => left.solvedCount === right.solvedCount && left.penaltySeconds === right.penaltySeconds && left.lastAcceptedAt?.getTime() === right.lastAcceptedAt?.getTime())
  return rows.map((row, index): StandingDraftEntry => ({
    userId: row.participant.userId,
    organizationIdSnapshot: row.participant.organizationIdSnapshot,
    rank: ranks[index],
    ratingTieGroup: `ac:${row.solvedCount}:penalty:${row.penaltySeconds}`,
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
}) {
  const visibleParticipants = input.participants.filter(item => item.disposition !== 'EXCLUDE')
  const rows = input.track === 'ACM'
    ? acmStanding(input.startTime, input.problems, input.submissions, visibleParticipants)
    : scoreBasedStanding(input.track, input.problems, input.submissions, visibleParticipants)
  const normal = rows.filter(item => item.participantDisposition !== 'FORCE_LAST')
  const forcedLast = rows.filter(item => item.participantDisposition === 'FORCE_LAST')
  normal.forEach((item, index) => {
    item.rank = index > 0 && item.ratingTieGroup === normal[index - 1].ratingTieGroup
      ? normal[index - 1].rank
      : index + 1
  })
  forcedLast.forEach(item => {
    item.rank = normal.length + 1
    item.ratingTieGroup = 'disposition:forced-last'
  })
  return [...normal, ...forcedLast]
}
