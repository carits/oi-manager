import { describe, expect, it } from 'vitest'
import { orderProblemSelectionResults, problemReferenceAddReceipt, problemSelectionInputError, ProblemReferenceOperation } from './model/problemSelection'
import type { ProblemSelectionItem, ResolvedProblemSelection } from '@oi-manager/contracts'

const input: ProblemSelectionItem = { clientKey: 'one', platform: 'luogu', problemId: 'P0001' }
const problem = { id: 'canonical-one', platform: 'luogu', problemId: 'P0001', title: 'One' }
const result: ResolvedProblemSelection = { ...input, status: 'resolved', problem }

describe('problem reference lifecycle', () => {
  it('invalidates and physically aborts old requests on replacement', () => {
    const gate = new ProblemReferenceOperation()
    const first = gate.begin('luogu:P0001')
    expect(gate.isRunning('luogu:P0001')).toBe(true)
    const second = gate.begin('codeforces:P0001')
    expect(first.isCurrent()).toBe(false)
    expect(first.signal.aborted).toBe(true)
    gate.finish(first)
    expect(gate.isRunning('codeforces:P0001')).toBe(true)
    expect(second.isCurrent()).toBe(true)
  })
  it('invalidates pending operations on disable, unmount and context reset', () => {
    const gate = new ProblemReferenceOperation()
    const ticket = gate.begin('org-a')
    gate.cancel()
    expect(ticket.isCurrent()).toBe(false)
    expect(ticket.signal.aborted).toBe(true)
    const next = gate.begin('org-b')
    gate.finish(next)
    expect(gate.isRunning('org-b')).toBe(false)
    expect(next.isCurrent()).toBe(true)
  })
  it('rejects mixed input in the single field without changing number case or zeroes', () => {
    expect(problemSelectionInputError(['P0001'])).toBeNull()
    expect(problemSelectionInputError(['p0001'])).toBeNull()
    expect(problemSelectionInputError(['P0001 P0002'])).toContain('文本模式')
    expect(problemSelectionInputError(['https://example.test/problem/1'])).toContain('链接')
  })
  it('restores request order by clientKey', () => {
    const two = { ...input, clientKey: 'two', problemId: 'P0002' }
    const other: ResolvedProblemSelection = { ...two, status: 'not_found' }
    expect(orderProblemSelectionResults([input, two], [other, result])).toEqual([result, other])
  })
  it('rejects incomplete, repeated, foreign and contradictory rows', () => {
    expect(() => orderProblemSelectionResults([input], [])).toThrow('不完整')
    expect(() => orderProblemSelectionResults([input], [result, result])).toThrow('不完整')
    expect(() => orderProblemSelectionResults([input], [{ ...result, clientKey: 'foreign' }])).toThrow('不一致')
    expect(() => orderProblemSelectionResults([input], [{ ...result, platform: 'codeforces' }])).toThrow('不一致')
    expect(() => orderProblemSelectionResults([input], [{ ...result, problemId: 'p0001' }])).toThrow('不一致')
    expect(() => orderProblemSelectionResults([input], [{ ...result, problem: { ...problem, problemId: 'P0002' } }])).toThrow('不一致')
  })
  it('keeps every unacknowledged item when the caller partially accepts a batch', () => {
    const second = { ...problem, id: 'canonical-two', problemId: 'P0002' }
    const receipt = problemReferenceAddReceipt([{ problem }, { problem: second }], { acceptedIds: [problem.id] })
    expect(receipt.acceptedIds).toEqual([problem.id])
    expect(receipt.rejected).toEqual([{ id: second.id, message: '未选入当前表单，请重试' }])
  })
  it('preserves specific business errors and rejects forged receipts', () => {
    expect(problemReferenceAddReceipt([{ problem }], { acceptedIds: [], rejected: [{ id: problem.id, message: '阶段已关闭' }] }).rejected?.[0].message).toBe('阶段已关闭')
    expect(() => problemReferenceAddReceipt([{ problem }], { acceptedIds: ['foreign'] })).toThrow('回执')
    expect(() => problemReferenceAddReceipt([{ problem }], { acceptedIds: [problem.id, problem.id] })).toThrow('回执')
    expect(() => problemReferenceAddReceipt([{ problem }], { acceptedIds: [problem.id], rejected: [{ id: problem.id, message: '矛盾' }] })).toThrow('回执')
    expect(problemReferenceAddReceipt([{ problem }], undefined)).toEqual({ acceptedIds: [problem.id] })
  })
})
