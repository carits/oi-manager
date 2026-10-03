import { describe, expect, it } from 'vitest'
import { progressiveStageAllowsEmptyProblems, progressiveStagePurposeDefaults, progressiveStageQueueState } from '../src/modules/training-engine/training-progressive-stage'

describe('progressive training stages', () => {
  it('maps product purposes to runtime stage behavior', () => {
    expect(progressiveStagePurposeDefaults.PRACTICE).toEqual({ kind: 'TRAINING', mode: 'PRACTICE', submissionMode: 'ENABLED' })
    expect(progressiveStagePurposeDefaults.GUIDED).toEqual({ kind: 'TRAINING', mode: 'GUIDED', submissionMode: 'ENABLED' })
    expect(progressiveStagePurposeDefaults.TEACHING).toEqual({ kind: 'TEACHING', mode: 'GUIDED', submissionMode: 'DISABLED' })
    expect(progressiveStagePurposeDefaults.REVIEW).toEqual({ kind: 'REVIEW', mode: 'REVIEW', submissionMode: 'DISABLED' })
  })

  it('allows empty teaching and review stages but not practice stages', () => {
    expect(progressiveStageAllowsEmptyProblems('TEACHING')).toBe(true)
    expect(progressiveStageAllowsEmptyProblems('REVIEW')).toBe(true)
    expect(progressiveStageAllowsEmptyProblems('PRACTICE')).toBe(false)
    expect(progressiveStageAllowsEmptyProblems('GUIDED')).toBe(false)
  })

  it('detects legacy queues and converges naturally', () => {
    expect(progressiveStageQueueState([{ lifecycle: 'RUNNING' }, { lifecycle: 'PENDING' }])).toEqual({ pendingCount: 1, legacy: false, canPrepare: true })
    expect(progressiveStageQueueState([{ lifecycle: 'PENDING' }, { lifecycle: 'PENDING' }])).toEqual({ pendingCount: 2, legacy: true, canPrepare: false })
    expect(progressiveStageQueueState([{ lifecycle: 'ENDED' }])).toEqual({ pendingCount: 0, legacy: false, canPrepare: true })
  })
})
