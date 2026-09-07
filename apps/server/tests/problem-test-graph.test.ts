import { describe, expect, it } from 'vitest'
import { validateTestGraphInput } from '../src/modules/problem/problem.test-graph.service'

function validGraph() {
  return {
    revision: 3,
    subtasks: [
      {
        id: 1,
        score: 100,
        if: [],
        groups: [
          { key: 'official-1', name: '官方测试组', kind: 'official', score: 100, type: 'min', cases: [{ testcaseId: 'case-1' }] },
          { key: 'hack-gate', name: 'Hack 得分门槛', kind: 'hack_gate', score: 0, type: 'min', cases: [] },
        ],
      },
    ],
  }
}

describe('OI Test Graph validation', () => {
  it('accepts a complete graph with a read-only Hack Gate shape', () => {
    expect(validateTestGraphInput(validGraph())).toEqual([])
  })

  it('reports score, empty group and duplicate testcase errors with paths', () => {
    const graph = validGraph()
    graph.subtasks[0].score = 90
    graph.subtasks[0].groups[0].score = 80
    graph.subtasks[0].groups[0].cases = [{ testcaseId: 'case-1' }, { testcaseId: 'case-1' }]
    const errors = validateTestGraphInput(graph)
    expect(errors.some(error => error.path === 'subtasks' && error.message.includes('必须为 100'))).toBe(true)
    expect(errors.some(error => error.path.includes('groups') && error.message.includes('分值之和'))).toBe(true)
    expect(errors.some(error => error.path.endsWith('.cases') && error.message.includes('重复 Testcase'))).toBe(true)
  })

  it('rejects self dependencies and dependency cycles', () => {
    const graph = validGraph()
    graph.subtasks = [
      { ...graph.subtasks[0], id: 1, score: 50, if: [2], groups: graph.subtasks[0].groups.map(group => ({ ...group, score: group.kind === 'official' ? 50 : 0 })) },
      { ...graph.subtasks[0], id: 2, score: 50, if: [1], groups: graph.subtasks[0].groups.map(group => ({ ...group, key: group.kind === 'official' ? 'official-2' : 'hack-gate', score: group.kind === 'official' ? 50 : 0 })) },
    ]
    expect(validateTestGraphInput(graph).some(error => error.message.includes('不能形成环'))).toBe(true)

    graph.subtasks[0].if = [1]
    graph.subtasks[1].if = []
    expect(validateTestGraphInput(graph).some(error => error.message.includes('不能依赖自身'))).toBe(true)
  })

  it('requires exactly one Hack Gate and unique group keys', () => {
    const graph = validGraph()
    graph.subtasks[0].groups.push({ ...graph.subtasks[0].groups[1] })
    const errors = validateTestGraphInput(graph)
    expect(errors.some(error => error.message.includes('恰好有一个 Hack Gate'))).toBe(true)
    expect(errors.some(error => error.message.includes('key 不能为空或重复'))).toBe(true)
  })

  it('limits OI problems to 15 subtasks', () => {
    const graph = validGraph()
    graph.subtasks = Array.from({ length: 16 }, (_, index) => ({
      ...graph.subtasks[0],
      id: index + 1,
      score: index === 0 ? 100 : 0,
      groups: graph.subtasks[0].groups.map(group => ({ ...group, key: group.kind === 'official' ? `official-${index + 1}` : 'hack-gate', score: group.kind === 'official' ? (index === 0 ? 100 : 0) : 0 })),
    }))
    expect(validateTestGraphInput(graph).some(error => error.message.includes('最多允许 15 个 Subtask'))).toBe(true)
  })

  it('counts unique testcases across Official Groups and Hack Gate toward the limit', () => {
    const graph = validGraph()
    graph.subtasks[0].groups = [
      { key: 'official-1', name: 'A', kind: 'official', score: 50, type: 'min', cases: Array.from({ length: 6 }, (_, index) => ({ testcaseId: `case-${index + 1}` })) },
      { key: 'official-2', name: 'B', kind: 'official', score: 50, type: 'min', cases: Array.from({ length: 5 }, (_, index) => ({ testcaseId: `case-${index + 6}` })) },
      { key: 'hack-gate', name: 'Hack', kind: 'hack_gate', score: 0, type: 'min', cases: [{ testcaseId: 'case-1' }] },
    ]
    expect(validateTestGraphInput(graph).some(error => error.message.includes('11 个唯一正式测试点'))).toBe(true)

    graph.subtasks[0].groups[1].cases = Array.from({ length: 4 }, (_, index) => ({ testcaseId: `case-${index + 6}` }))
    expect(validateTestGraphInput(graph).some(error => error.message.includes('唯一正式测试点'))).toBe(false)
  })
})
