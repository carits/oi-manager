import { describe, expect, it } from 'vitest'
import { hasContestAttachments } from '../attachment-state'

describe('contest attachment empty state', () => {
  it('treats per-problem empty arrays as an empty activity', () => {
    expect(hasContestAttachments({ A: [], B: [] })).toBe(false)
  })

  it('detects an attachment in every problem group', () => {
    expect(hasContestAttachments({
      A: [],
      B: [{ id: 'file' }],
    })).toBe(true)
  })
})
