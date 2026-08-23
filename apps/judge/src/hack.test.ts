import { describe, expect, it } from 'vitest'
import { buildCandidateConfig, isEffectiveHackVerdictChange } from './hack'

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
})
