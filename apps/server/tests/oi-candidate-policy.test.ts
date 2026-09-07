import { describe, expect, it } from 'vitest'
import {
  leaveOneOutValues,
  chooseBestEviction,
  requiredReplacementGain,
  resolveCorpusMode,
  scoreCaseSet,
  validateOiFormalLimits,
} from '../src/modules/problem/problem.oi-candidate-policy'

describe('bounded OI candidate policy', () => {
  it('maps per-subtask corpus counts to CLOSED, LIMITED and OPEN', () => {
    expect(resolveCorpusMode(0, 0)).toBe('closed')
    expect(resolveCorpusMode(1, 1)).toBe('limited')
    expect(resolveCorpusMode(5, 2)).toBe('limited')
    expect(resolveCorpusMode(5, 3)).toBe('open')
  })

  it('requires both the absolute and relative replacement gain', () => {
    expect(requiredReplacementGain(200)).toBe(50)
    expect(requiredReplacementGain(2000)).toBe(100)
  })

  it('values unique cluster and feature coverage above duplicate cases', () => {
    const corpus = [{ id: 'a', weight: 5 }, { id: 'b', weight: 5 }]
    const duplicate = [
      { id: 'x', semanticFingerprint: 'same', killedClusters: [{ id: 'a', weight: 5 }], features: ['small'] },
      { id: 'y', semanticFingerprint: 'same', killedClusters: [{ id: 'a', weight: 5 }], features: ['small'] },
    ]
    const diverse = [
      duplicate[0],
      { id: 'z', semanticFingerprint: 'different', killedClusters: [{ id: 'b', weight: 5 }], features: ['boundary'] },
    ]
    expect(scoreCaseSet(diverse, corpus, ['small', 'boundary'])).toBeGreaterThan(scoreCaseSet(duplicate, corpus, ['small', 'boundary']))
    expect(leaveOneOutValues(duplicate, corpus, ['small']).get('x')).toBeLessThanOrEqual(leaveOneOutValues(diverse, corpus, ['small', 'boundary']).get('z')!)
  })

  it('rejects an immutable revision with more than ten unique cases in one subtask', () => {
    const cases = Array.from({ length: 11 }, (_, index) => ({ testcaseId: `case-${index}`, inputName: `${index}.in`, outputName: `${index}.out`, inputObjectId: `in-${index}`, outputObjectId: `out-${index}`, source: 'official' }))
    expect(validateOiFormalLimits({ mode: 'oi', subtasks: [{ id: 1, score: 100, if: [], groups: [{ key: 'official', name: 'Official', kind: 'official', score: 100, type: 'min', cases }, { key: 'hack-gate', name: 'Hack', kind: 'hack_gate', score: 0, type: 'min', cases: [] }] }] })[0]?.code).toBe('OI_SUBTASK_CASE_LIMIT_REACHED')
  })

  it('performs 11-choose-10 by evicting the redundant old membership', () => {
    const corpus = [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }]
    const unique = Array.from({ length: 9 }, (_, index) => ({ id: `core-${index}`, semanticFingerprint: `core-${index}`, killedClusters: [] as Array<{ id: string; weight: number }> }))
    const duplicate = { id: 'old-duplicate', semanticFingerprint: 'duplicate', killedClusters: [{ id: 'a', weight: 1 }] }
    const candidate = { id: 'candidate', semanticFingerprint: 'new', killedClusters: [{ id: 'b', weight: 1 }] }
    const best = chooseBestEviction({ pool: [...unique, duplicate, candidate], removableIds: new Set(['old-duplicate', 'candidate']), corpus, featureUniverse: [], preferCandidateId: 'candidate' })
    expect(best?.removed.id).toBe('old-duplicate')
  })

  it('keeps the candidate out when protected memberships are the only alternatives', () => {
    const candidate = { id: 'candidate', semanticFingerprint: 'same', killedClusters: [] }
    const best = chooseBestEviction({ pool: [{ id: 'protected', semanticFingerprint: 'core', killedClusters: [] }, candidate], removableIds: new Set(['candidate']), corpus: [], featureUniverse: [], preferCandidateId: 'candidate' })
    expect(best?.removed.id).toBe('candidate')
  })
})
