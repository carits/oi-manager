import { describe, expect, it } from 'vitest'
import { buildJudgeResultRows, firstFailedCaseIndex, formatJudgeMemory } from './judge-result'

describe('submission judge result presentation', () => {
  const cases = [
    { result: 'Accepted', score: 5, time: 10, memory: 1024 },
    { result: 'Wrong Answer', score: 0, time: 12, memory: 2048 },
  ]

  it('groups OI cases below their subtask', () => {
    const rows = buildJudgeResultRows('oi', cases, [{ id: 'all', type: 'sum', score: 5, cases }])
    expect(rows.map(row => row.kind)).toEqual(['subtask', 'case', 'case'])
  })

  it('keeps ACM as a flat testcase list and finds the first failure', () => {
    expect(buildJudgeResultRows('acm', cases, null).map(row => row.kind)).toEqual(['case', 'case'])
    expect(firstFailedCaseIndex(cases)).toBe(1)
  })

  it('formats judge memory from KiB', () => {
    expect(formatJudgeMemory(1024)).toBe('1.00 MB')
    expect(formatJudgeMemory(null)).toBe('-')
  })
})
