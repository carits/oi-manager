import { describe, expect, it } from 'vitest'
import { calculateAssignmentGrade, judgeMaxScoreFromSnapshot, mapJudgeScore } from '../src/modules/assignment/assignment-grading'

describe('assignment grading semantics', () => {
  it('maps the immutable judge scale proportionally onto assignment points', () => {
    expect(mapJudgeScore({ score: 70, result: 'partial', judgeMaxScore: 100, assignmentMaxScore: 150 })).toBe(105)
    expect(mapJudgeScore({ score: null, result: 'accepted', judgeMaxScore: 100, assignmentMaxScore: 80 })).toBe(80)
  })

  it('derives the OI full score from the pinned projection', () => {
    expect(judgeMaxScoreFromSnapshot('mode: oi\nsubtasks:\n  - id: 1\n    score: 30\n  - id: 2\n    score: 70\n', 'oi')).toBe(100)
  })

  it('uses weights for required work and keeps optional and challenge outside the base denominator', () => {
    const result = calculateAssignmentGrade({
      gradingVersion: 2, baseScoreMax: 100,
      optionalScoringPolicy: 'BONUS', optionalBestCount: null, optionalBonusMax: 10,
      challengeScoringPolicy: 'EXTRA_CREDIT', challengeBonusMax: 5,
    }, [
      { id: 'required-light', category: 'REQUIRED', maxScore: 100, weight: 100 },
      { id: 'required-heavy', category: 'REQUIRED', maxScore: 100, weight: 300 },
      { id: 'optional', category: 'OPTIONAL', maxScore: 100, weight: 100 },
      { id: 'challenge', category: 'CHALLENGE', maxScore: 100, weight: 100 },
    ], [
      { assignmentProblemId: 'required-light', finalScore: 100 },
      { assignmentProblemId: 'required-heavy', finalScore: 0 },
      { assignmentProblemId: 'optional', finalScore: 100 },
      { assignmentProblemId: 'challenge', finalScore: 100 },
    ])
    expect(result).toMatchObject({ rawScore: 40, maxScore: 115, components: { required: 25, optional: 10, challenge: 5 } })
  })

  it('selects only the highest normalized optional results for BEST_N', () => {
    const result = calculateAssignmentGrade({
      gradingVersion: 2, baseScoreMax: 100,
      optionalScoringPolicy: 'BEST_N', optionalBestCount: 1, optionalBonusMax: 20,
      challengeScoringPolicy: 'NONE', challengeBonusMax: 0,
    }, [
      { id: 'required', category: 'REQUIRED', maxScore: 100, weight: 100 },
      { id: 'optional-a', category: 'OPTIONAL', maxScore: 100, weight: 100 },
      { id: 'optional-b', category: 'OPTIONAL', maxScore: 200, weight: 100 },
    ], [
      { assignmentProblemId: 'required', finalScore: 100 },
      { assignmentProblemId: 'optional-a', finalScore: 50 },
      { assignmentProblemId: 'optional-b', finalScore: 160 },
    ])
    expect(result.components.optional).toBe(16)
  })
})
