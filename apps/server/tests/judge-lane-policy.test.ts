import { describe, expect, it } from 'vitest'
import { judgeLaneForDispatch } from '../src/modules/judge/domain/judge-lane-policy'

describe('Judge weighted lane policy', () => {
  it('reserves eight submission slots, one Hack slot and one Candidate slot per cycle', () => {
    const cycle = Array.from({ length: 10 }, (_, index) => judgeLaneForDispatch(index))
    expect(cycle.filter(item => item === 'submission')).toHaveLength(8)
    expect(cycle.filter(item => item === 'hack')).toHaveLength(1)
    expect(cycle.filter(item => item === 'generation')).toHaveLength(1)
    expect(judgeLaneForDispatch(10)).toBe('submission')
  })
})
