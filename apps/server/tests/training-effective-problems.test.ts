import { describe, expect, it } from 'vitest'
import { resolveEffectiveProblemIdsFromSnapshot } from '../src/modules/training-engine/training-effective-problems.service'

describe('Training V3 effective problem resolver', () => {
  const assignments = [
    { roundId: 'round-1', groupId: 'group-a', sessionProblemId: 'problem-b', active: true, orderIndex: 1 },
    { roundId: 'round-1', groupId: 'group-a', sessionProblemId: 'problem-a', active: true, orderIndex: 0 },
    { roundId: 'round-1', groupId: 'group-a', sessionProblemId: 'problem-retired', active: false, orderIndex: 2 },
    { roundId: 'round-1', groupId: 'group-b', sessionProblemId: 'problem-group-b', active: true, orderIndex: 0 },
    { roundId: 'round-2', groupId: 'group-a', sessionProblemId: 'problem-future', active: true, orderIndex: 0 },
  ]

  it('returns only the ordered active set for the current round and group', () => {
    expect(resolveEffectiveProblemIdsFromSnapshot('round-1', 'group-a', assignments)).toEqual(['problem-a', 'problem-b'])
  })

  it('does not leak another group or pending round', () => {
    expect(resolveEffectiveProblemIdsFromSnapshot('round-1', 'group-b', assignments)).toEqual(['problem-group-b'])
    expect(resolveEffectiveProblemIdsFromSnapshot(null, 'group-a', assignments)).toEqual([])
  })

  it('restores the same stable session problem identity after an assignment is re-added', () => {
    const removed = assignments.map(item => item.sessionProblemId === 'problem-a' ? { ...item, active: false } : item)
    expect(resolveEffectiveProblemIdsFromSnapshot('round-1', 'group-a', removed)).toEqual(['problem-b'])
    const readded = removed.map(item => item.sessionProblemId === 'problem-a' ? { ...item, active: true } : item)
    expect(resolveEffectiveProblemIdsFromSnapshot('round-1', 'group-a', readded)).toEqual(['problem-a', 'problem-b'])
  })
})

