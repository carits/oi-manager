import { describe, expect, it } from 'vitest'
import { nonScoringJudgeConfig, revisionDataLayout } from '../src/modules/problem/problem.activity-revision-repair.service'

const groupCase = {
  testcaseId: 'case-1',
  inputObjectId: 'input-1',
  outputObjectId: 'output-1',
  inputName: '1.in',
  outputName: '1.out',
  orderIndex: 0,
  score: 5,
  time: null,
  memory: null,
  source: 'official',
}

function revision(aggregation: string, inputObjectId = 'input-1') {
  return {
    mode: 'oi',
    AcmCases: [],
    Subtasks: [{
      subtaskId: 1,
      orderIndex: 0,
      score: 100,
      Groups: [{
        key: 'official-1',
        kind: 'official',
        orderIndex: 0,
        score: 100,
        aggregation,
        Cases: [{ ...groupCase, inputObjectId }],
      }],
    }],
  }
}

describe('activity TestSet Revision repair safety', () => {
  it('treats scoring-only group changes as the same immutable data layout', () => {
    expect(revisionDataLayout(revision('min'))).toEqual(revisionDataLayout(revision('sum')))
  })

  it('rejects revisions whose immutable data objects differ', () => {
    expect(revisionDataLayout(revision('min'))).not.toEqual(revisionDataLayout(revision('sum', 'input-2')))
  })

  it('ignores subtask scoring while retaining checker and file I/O configuration', () => {
    const min = 'mode: oi\nfilename: median\nchecker_type: default\nsubtasks:\n  - id: 1\n    score: 100\n    type: min\n'
    const sum = 'mode: oi\nfilename: median\nchecker_type: default\nsubtasks:\n  - id: 1\n    score: 100\n    type: sum\n'
    const changedChecker = 'mode: oi\nfilename: median\nchecker_type: testlib\nsubtasks: []\n'
    expect(nonScoringJudgeConfig(min)).toEqual(nonScoringJudgeConfig(sum))
    expect(nonScoringJudgeConfig(min)).not.toEqual(nonScoringJudgeConfig(changedChecker))
  })
})
