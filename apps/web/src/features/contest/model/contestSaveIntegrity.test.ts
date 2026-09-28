import { describe, expect, it } from 'vitest'
import {
  assertContestProblemMembership,
  contestProblemDeletions,
  contestProblemOrders,
  contestProblemSnapshot,
} from './contestSaveIntegrity'

describe('contest problem save integrity', () => {
  it('preserves the mixed existing/new row order when server IDs are returned', () => {
    const rows = [
      { id: 'row-a', contestProblemId: 'entry-a' },
      { id: 'row-b' },
      { id: 'row-c', contestProblemId: 'entry-c' },
    ]
    expect(contestProblemOrders(rows, new Map([['row-b', 'entry-b']]))).toEqual([
      { id: 'entry-a', orderIndex: 0 },
      { id: 'entry-b', orderIndex: 1 },
      { id: 'entry-c', orderIndex: 2 },
    ])
  })

  it('refuses ordering when a new row lacks a server ID or IDs collide', () => {
    expect(() => contestProblemOrders([{ id: 'new' }], new Map())).toThrow('尚未取得服务端条目 ID')
    expect(() => contestProblemOrders([
      { id: 'a', contestProblemId: 'same' },
      { id: 'b', contestProblemId: 'same' },
    ], new Map())).toThrow('比赛条目 ID 重复')
  })

  it('only deletes entries that were present in the loaded baseline', () => {
    const baseline = [
      { id: 'entry-a', problemId: 'problem-a' },
      { id: 'entry-b', problemId: 'problem-b' },
    ]
    expect(contestProblemDeletions(baseline, [
      { id: 'row-a', contestProblemId: 'entry-a' },
      { id: 'new-row' },
    ])).toEqual(['entry-b'])
  })

  it('detects membership changes before sending a partial reorder', () => {
    expect(() => assertContestProblemMembership(
      [{ id: 'entry-a', problemId: 'a' }, { id: 'entry-b', problemId: 'b' }],
      [{ id: 'entry-a' }],
    )).toThrow('比赛题目集合已变化')
    expect(() => assertContestProblemMembership(
      [{ id: 'entry-a', problemId: 'a' }],
      [{ id: 'entry-a' }],
    )).not.toThrow()
  })

  it('includes order and editable fields in the baseline snapshot', () => {
    expect(contestProblemSnapshot([
      { id: '1', problemId: 'a', alias: 'A', points: 100 },
      { id: '2', problemId: 'b', alias: 'B', points: null },
    ])).not.toBe(contestProblemSnapshot([
      { id: '2', problemId: 'b', alias: 'B', points: null },
      { id: '1', problemId: 'a', alias: 'A2', points: 100 },
    ]))
  })
})
