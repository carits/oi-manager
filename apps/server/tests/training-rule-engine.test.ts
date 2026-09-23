import { describe, expect, it } from 'vitest'
import {
  evaluateProblemTimePolicy,
  normalizeTrainingAccessScope,
  normalizeTrainingProblemTimePolicy,
  resolveEffectiveTrainingRule,
  resolveNextScoreTarget,
  resolveTrainingScorePolicy,
} from '../src/modules/training-engine/domain/training-rule-engine'

describe('training rule engine', () => {
  it('normalizes legacy problem time modes into canonical actions', () => {
    expect(normalizeTrainingProblemTimePolicy({ mode: 'SOFT', limitSeconds: 600 })).toEqual({
      type: 'PROBLEM_LIMIT', limitSeconds: 600, action: 'REMIND',
    })
    expect(normalizeTrainingProblemTimePolicy({ mode: 'HARD', limitSeconds: 600 })).toEqual({
      type: 'PROBLEM_LIMIT', limitSeconds: 600, action: 'LOCK_SUBMISSION',
    })
    expect(normalizeTrainingProblemTimePolicy({ mode: 'SWITCH_REQUIRED', limitSeconds: 600 })).toEqual({
      type: 'PROBLEM_LIMIT', limitSeconds: 600, action: 'FORCE_SWITCH',
    })
  })

  it('supports all four canonical time actions', () => {
    for (const action of ['REMIND', 'RECOMMEND_SWITCH', 'LOCK_SUBMISSION', 'FORCE_SWITCH'] as const) {
      const policy = normalizeTrainingProblemTimePolicy({ mode: action, action, limitSeconds: 300 })
      expect(policy).toEqual({ type: 'PROBLEM_LIMIT', limitSeconds: 300, action })
      const state = evaluateProblemTimePolicy(policy, 300, false)
      expect(state.reached).toBe(true)
      expect(state.action).toBe(action)
    }
    expect(evaluateProblemTimePolicy({ type: 'PROBLEM_LIMIT', limitSeconds: 300, action: 'LOCK_SUBMISSION' }, 300, false).canSubmit).toBe(false)
    expect(evaluateProblemTimePolicy({ type: 'PROBLEM_LIMIT', limitSeconds: 300, action: 'FORCE_SWITCH' }, 300, false).switchRequired).toBe(true)
    expect(evaluateProblemTimePolicy({ type: 'PROBLEM_LIMIT', limitSeconds: 300, action: 'RECOMMEND_SWITCH' }, 300, false).switchRecommended).toBe(true)
    expect(evaluateProblemTimePolicy({ type: 'PROBLEM_LIMIT', limitSeconds: 300, action: 'REMIND' }, 300, false).remind).toBe(true)
  })

  it('applies runtime > problem > group > stage precedence', () => {
    const resolved = resolveEffectiveTrainingRule({
      stage: {
        kind: 'TRAINING',
        accessPolicy: 'ALL_AT_ONCE',
        submissionMode: 'ENABLED',
        endPolicy: 'MANUAL',
        defaultTargetScore: 100,
        rules: {
          accessScope: 'CURRENT_STAGE',
          timePolicy: { mode: 'REMIND', limitSeconds: 1200 },
          stuckPolicy: { minActiveSeconds: 1800, minAttempts: 3, noImprovementSeconds: 900 },
        },
      },
      group: {
        accessPolicy: 'SEQUENTIAL',
        submissionMode: 'ENABLED',
        rules: {
          timePolicy: { mode: 'RECOMMEND_SWITCH', limitSeconds: 900 },
          stuckPolicy: { minActiveSeconds: 1200, minAttempts: 2, noImprovementSeconds: 600 },
        },
      },
      plan: {
        targetScore: 80,
        scoreGoals: [{ score: 30 }, { score: 60 }, { score: 80 }],
        timePolicy: { mode: 'LOCK_SUBMISSION', limitSeconds: 600 },
        stuckPolicy: { minActiveSeconds: 900, minAttempts: 2, noImprovementSeconds: 480 },
        hintPolicy: { enabled: true },
        rules: {},
      },
      runtimeOverride: {
        timePolicy: { mode: 'FORCE_SWITCH', limitSeconds: 300 },
        submissionPolicy: 'DISABLED',
      },
    })

    expect(resolved.problemAccessPolicy).toBe('SEQUENTIAL')
    expect(resolved.accessScope).toBe('CURRENT_STAGE')
    expect(resolved.submissionPolicy).toBe('DISABLED')
    expect(resolved.timePolicy).toEqual({ type: 'PROBLEM_LIMIT', limitSeconds: 300, action: 'FORCE_SWITCH' })
    expect(resolved.scorePolicy).toEqual({ type: 'PROGRESSIVE', targets: [30, 60, 80], completionScore: 80 })
    expect(resolved.stuckPolicy).toEqual({ minActiveSeconds: 900, minAttempts: 2, noImprovementSeconds: 480 })
  })

  it('resolves progressive score targets without creating stage modes', () => {
    const policy = resolveTrainingScorePolicy({ scoreGoals: [{ score: 30 }, { score: 60 }, { score: 100 }] })
    expect(policy.type).toBe('PROGRESSIVE')
    expect(resolveNextScoreTarget(policy, 0)).toBe(30)
    expect(resolveNextScoreTarget(policy, 30)).toBe(60)
    expect(resolveNextScoreTarget(policy, 89)).toBe(100)
    expect(resolveNextScoreTarget(policy, 100)).toBeNull()
  })

  it('defaults access scope to the current stage', () => {
    expect(normalizeTrainingAccessScope(undefined)).toBe('CURRENT_STAGE')
    expect(normalizeTrainingAccessScope('PREVIOUS_AND_CURRENT')).toBe('PREVIOUS_AND_CURRENT')
    expect(normalizeTrainingAccessScope('SESSION_ALL')).toBe('SESSION_ALL')
    expect(normalizeTrainingAccessScope('ALL')).toBe('CURRENT_STAGE')
  })
})
