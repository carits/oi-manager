import { describe, expect, it, vi } from 'vitest'
import {
  assertHackTransition,
  InvalidHackTransition,
  transitionHackAttempt,
  transitionHackAttempts,
} from '../src/modules/problem/problem.hack-state'

describe('HackAttempt state machine', () => {
  it('accepts the normal technical evaluation and promotion lifecycle', () => {
    expect(() => assertHackTransition('queuing', 'judging')).not.toThrow()
    expect(() => assertHackTransition('judging', 'finalizing')).not.toThrow()
    expect(() => assertHackTransition('finalizing', 'accepted')).not.toThrow()
  })

  it('rejects terminal state resurrection and skipped ownership states', () => {
    expect(() => assertHackTransition('accepted', 'judging')).toThrow(InvalidHackTransition)
    expect(() => assertHackTransition('queuing', 'accepted')).toThrow(InvalidHackTransition)
    expect(() => assertHackTransition('system_error', 'accepted')).toThrow(InvalidHackTransition)
  })

  it('persists a compare-and-swap transition with owner fencing', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    await transitionHackAttempt({ problemHackAttempt: { updateMany } }, {
      id: 'hack-1', from: 'judging', to: 'finalizing', judgeId: 'judge-a', data: { message: null },
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'hack-1', status: 'judging', judgeId: 'judge-a' },
      data: { message: null, status: 'finalizing' },
    })
  })

  it('validates every source state before bulk recovery', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 })
    await transitionHackAttempts({ problemHackAttempt: { updateMany } }, {
      from: ['judging', 'finalizing'], to: 'queuing', where: { judgeId: 'judge-a' }, data: { judgeId: null },
    })
    expect(updateMany).toHaveBeenCalledOnce()
    await expect(transitionHackAttempts({ problemHackAttempt: { updateMany } }, {
      from: ['accepted'], to: 'queuing',
    })).rejects.toThrow(InvalidHackTransition)
  })
})
