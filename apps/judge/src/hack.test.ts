import { describe, expect, it } from 'vitest'
import { buildCandidateConfig, hasStandardOutput, isEffectiveHackVerdictChange, isEffectiveOiHackScoreChange } from './hack'

describe('ACM Hack verdict comparison', () => {
  it('accepts any deterministic final verdict change', () => {
    expect(isEffectiveHackVerdictChange('Accepted', 'Wrong Answer')).toBe(true)
    expect(isEffectiveHackVerdictChange('Wrong Answer', 'Time Limit Exceeded')).toBe(true)
    expect(isEffectiveHackVerdictChange('Time Limit Exceeded', 'Wrong Answer')).toBe(true)
  })

  it('rejects equal verdicts and system results', () => {
    expect(isEffectiveHackVerdictChange('Wrong Answer', 'Wrong Answer')).toBe(false)
    expect(isEffectiveHackVerdictChange('System Error', 'Wrong Answer')).toBe(false)
    expect(isEffectiveHackVerdictChange('Compilation Error', 'Accepted')).toBe(false)
  })

  it('places the candidate before every existing ACM case', () => {
    const result = buildCandidateConfig(
      { mode: 'acm', cases: [{ input: '1.in', output: '1.out' }] },
      '.',
      { input: '.hack_pending_id.in', output: '.hack_pending_id.out' },
    )
    expect(result.cases?.map(item => item.input)).toEqual(['.hack_pending_id.in', '1.in'])
    expect(result.subtasks).toBeUndefined()
  })

  it('requires the standard program to generate an answer', () => {
    expect(hasStandardOutput(undefined)).toBe(false)
    expect(hasStandardOutput('')).toBe(false)
    expect(hasStandardOutput('\n')).toBe(true)
    expect(hasStandardOutput('0\n')).toBe(true)
  })
})

describe('OI Hack score comparison and gate projection', () => {
  it('accepts only a strict total score decrease', () => {
    expect(isEffectiveOiHackScoreChange(90, 70)).toBe(true)
    expect(isEffectiveOiHackScoreChange(100, 0)).toBe(true)
    expect(isEffectiveOiHackScoreChange(70, 70)).toBe(false)
    expect(isEffectiveOiHackScoreChange(70, 90)).toBe(false)
  })

  it('adds one candidate to every classified Hack Gate without duplicating data', () => {
    const result = buildCandidateConfig({
      mode: 'oi',
      subtasks: [1, 2, 3].map(id => ({
        id,
        score: id === 3 ? 40 : 30,
        groups: [
          { id: `official-${id}`, kind: 'official', score: id === 3 ? 40 : 30, type: 'min', cases: [{ input: `${id}.in`, output: `${id}.out` }] },
          { id: `gate-${id}`, kind: 'hack_gate', score: 0, type: 'min', cases: [] },
        ],
      })),
    }, '.', { input: '.hack_pending.in', output: '.hack_pending.out', score: 100 }, [1, 3])

    expect(result.subtasks?.[0].groups?.[1].cases).toHaveLength(1)
    expect(result.subtasks?.[1].groups?.[1].cases).toHaveLength(0)
    expect(result.subtasks?.[2].groups?.[1].cases).toHaveLength(1)
    expect(result.subtasks?.[0].groups?.[1].cases?.[0].score).toBe(100)
  })

  it('fails closed when a classified subtask has no Hack Gate', () => {
    expect(() => buildCandidateConfig({
      mode: 'oi',
      subtasks: [{ id: 1, score: 100, groups: [{ id: 'official', kind: 'official', score: 100, type: 'min', cases: [] }] }],
    }, '.', { input: '.hack_pending.in', output: '.hack_pending.out', score: 100 }, [1])).toThrow('Hack Gate')
  })
})
