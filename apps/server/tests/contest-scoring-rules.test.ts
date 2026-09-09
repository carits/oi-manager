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
})
