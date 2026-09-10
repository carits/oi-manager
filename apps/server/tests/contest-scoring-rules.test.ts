import { describe, expect, it } from 'vitest'
import { buildStanding, normalizeScoringRules } from '../src/modules/rating/domain/contest-scoring'

describe('frozen contest scoring rules', () => {
  it('keeps the IOI defaults when an older frozen object omits optional fields', () => {
    expect(normalizeScoringRules('IOI', { version: 1 })).toMatchObject({
      problemPolicy: 'BEST_SUBMISSION',
      tiePolicy: 'SCORE',
      judgeMaxScore: 100,
    })
  })

  it('uses the frozen ACM penalty rather than the current default', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const [entry] = buildStanding({
      track: 'ACM', startTime,
      scoringRules: { version: 1, wrongPenaltySeconds: 900, penaltyVerdicts: ['WA'], compileErrorPenalty: false, ratingTiePolicy: 'SOLVED_PENALTY' },
      problems: [{ id: 'problem', points: 100 }],
      participants: [{ userId: 'user', organizationIdSnapshot: null, disposition: 'NORMAL', ratingLocked: true }],
      submissions: [
        { id: 1, userId: 'user', trainingProblemId: 'problem', result: 'wrong_answer', score: 0, createdAt: new Date('2026-01-01T00:10:00Z'), submissionPhase: null },
        { id: 2, userId: 'user', trainingProblemId: 'problem', result: 'accepted', score: 100, createdAt: new Date('2026-01-01T00:20:00Z'), submissionPhase: null },
      ],
    })
    expect(entry.penaltySeconds).toBe(2100)
  })

  it('separates visible ACM ranks from rating tie groups in version 2', () => {
    const startTime = new Date('2026-01-01T00:00:00Z')
    const rows = buildStanding({
      track: 'ACM', startTime,
      scoringRules: {
        version: 2,
        wrongPenaltySeconds: 1200,
        penaltyVerdicts: ['WA'],
        leaderboardTiePolicy: 'SOLVED_PENALTY_LAST_ACCEPTED',
        ratingTiePolicy: 'SOLVED_PENALTY',
      },
      problems: [{ id: 'a', points: 100 }, { id: 'b', points: 100 }],
      participants: [
        { userId: 'first', organizationIdSnapshot: null, disposition: 'NORMAL', ratingLocked: true },
        { userId: 'second', organizationIdSnapshot: null, disposition: 'NORMAL', ratingLocked: true },
      ],
      submissions: [
        { id: 1, userId: 'first', trainingProblemId: 'a', result: 'accepted', score: 100, createdAt: new Date('2026-01-01T00:10:00Z'), submissionPhase: null },
        { id: 2, userId: 'first', trainingProblemId: 'b', result: 'accepted', score: 100, createdAt: new Date('2026-01-01T00:20:00Z'), submissionPhase: null },
        { id: 3, userId: 'second', trainingProblemId: 'a', result: 'accepted', score: 100, createdAt: new Date('2026-01-01T00:15:00Z'), submissionPhase: null },
        { id: 4, userId: 'second', trainingProblemId: 'b', result: 'accepted', score: 100, createdAt: new Date('2026-01-01T00:15:00Z'), submissionPhase: null },
      ],
    })
    expect(rows.map(item => item.rank)).toEqual([1, 2])
    expect(rows[0].ratingTieGroup).toBe(rows[1].ratingTieGroup)
  })

  it('preserves the legacy version 1 tie semantics', () => {
    const rules = normalizeScoringRules('ACM', { version: 1, ratingTiePolicy: 'SOLVED_PENALTY_LAST_ACCEPTED' })
    expect(rules.leaderboardTiePolicy).toBe('SOLVED_PENALTY_LAST_ACCEPTED')
    expect(rules.ratingTiePolicy).toBe('SOLVED_PENALTY_LAST_ACCEPTED')
  })
})
