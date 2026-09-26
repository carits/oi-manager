import { describe, expect, it } from 'vitest'
import { flattenTrainingDesignParticipants } from '../src/modules/training-engine/training-engine.design'

describe('flattenTrainingDesignParticipants', () => {
  it('restores the owning group id required by the design response contract', () => {
    expect(flattenTrainingDesignParticipants([
      { id: 'group-a', Participants: [{ id: 'participant-1', userId: 'user-1', status: 'active' }] },
      { id: 'group-b', Participants: [{ id: 'participant-2', userId: 'user-2', status: 'active' }] },
    ])).toEqual([
      { id: 'participant-1', userId: 'user-1', status: 'active', groupId: 'group-a' },
      { id: 'participant-2', userId: 'user-2', status: 'active', groupId: 'group-b' },
    ])
  })

  it('keeps empty groups out of the participant list', () => {
    expect(flattenTrainingDesignParticipants([{ id: 'empty', Participants: [] }])).toEqual([])
  })
})
