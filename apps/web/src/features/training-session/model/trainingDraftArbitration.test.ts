import { describe, expect, it } from 'vitest'
import { arbitrateTrainingDraft, type TrainingDraftSnapshot } from './trainingDraftArbitration'

const draft = (overrides: Partial<TrainingDraftSnapshot> = {}): TrainingDraftSnapshot => ({
  code: '',
  language: 'cpp17',
  inputFilename: null,
  outputFilename: null,
  ...overrides,
})

describe('training draft arbitration', () => {
  it('keeps a locally restored or newly typed draft when the cloud draft differs', () => {
    const local = draft({ code: 'local changes' })
    const remote = draft({ code: 'cloud version' })
    expect(arbitrateTrainingDraft(local, remote, true)).toEqual({ type: 'conflict', local, remote })
  })

  it('accepts the cloud draft when no local change exists', () => {
    const remote = draft({ code: 'cloud version', language: 'python3' })
    expect(arbitrateTrainingDraft(draft(), remote, false)).toEqual({ type: 'remote', draft: remote })
  })

  it('does not report a conflict when local and cloud content are identical', () => {
    const shared = draft({ code: 'same', inputFilename: 'task.in' })
    expect(arbitrateTrainingDraft(shared, shared, true)).toEqual({ type: 'remote', draft: shared })
  })

  it('treats language and file IO differences as real conflicts', () => {
    const local = draft({ language: 'cpp17', outputFilename: 'task.out' })
    const remote = draft({ language: 'python3' })
    expect(arbitrateTrainingDraft(local, remote, true).type).toBe('conflict')
  })
})
