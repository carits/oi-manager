import { describe, expect, it } from 'vitest'
import { hasTrainingAttachments } from '../attachment-state'

describe('training attachment empty state', () => {
  it('treats per-problem empty arrays as an empty activity', () => {
    expect(hasTrainingAttachments({ A: [], B: [] })).toBe(false)
  })

  it('detects an attachment in every problem group', () => {
    expect(hasTrainingAttachments({
      A: [],
      B: [{ id: 'file' }],
    })).toBe(true)
  })
})
