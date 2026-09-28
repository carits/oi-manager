import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ResolvedProblemSelection } from '@oi-manager/contracts'
import { parseProblemIds, prepareProblemSelection, problemSelectionInputError } from './model/problemSelection'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const found: ResolvedProblemSelection = {
  clientKey: '1', platform: 'luogu', problemId: 'P1001', status: 'resolved',
  problem: { id: 'internal-1', platform: 'luogu', problemId: 'P1001', title: 'Example' },
}

describe('unified problem selection', () => {
  it('parses mixed separators, preserves order and removes exact duplicates', () => {
    expect(parseProblemIds('P1001, P1002\nP1001；CF1A')).toEqual(['P1001', 'P1002', 'CF1A'])
    expect(parseProblemIds('001 1 P1001 p1001')).toEqual(['001', '1', 'P1001', 'p1001'])
  })

  it('rejects an oversized batch without silently truncating user input', () => {
    const codes = parseProblemIds(Array.from({ length: 120 }, (_, index) => `P${index}`).join(' '))
    expect(codes).toHaveLength(120)
    expect(problemSelectionInputError(codes)).toContain('未截断')
    expect(problemSelectionInputError(codes.slice(0, 100))).toBeNull()
    expect(problemSelectionInputError(['P'.repeat(129)])).toContain('128')
  })

  it('does not infer platforms, prefixes or internal identifiers', () => {
    const uuid = '00000000-0000-0000-0000-000000000001'
    expect(parseProblemIds(`CF2036G ${uuid}`)).toEqual(['CF2036G', uuid])
  })

  it('finds metadata without claiming that Stable is available', () => {
    const assessment = prepareProblemSelection([found], [], true)
    expect(assessment.accepted).toHaveLength(0)
    expect(assessment.rows[0].result.status).toBe('resolved')
    expect(assessment.rows[0].message).toContain('已找到')
    expect(assessment.remainingProblemIds).toEqual(['P1001'])
    expect(prepareProblemSelection([found], [], false).accepted).toEqual([found.problem])
  })

  it('deduplicates against current canonical IDs and within the batch', () => {
    expect(prepareProblemSelection([found], ['internal-1'], true).rows[0].state).toBe('duplicate')
    const result = prepareProblemSelection([found, { ...found, clientKey: '2' }], [], false)
    expect(result.accepted).toHaveLength(1)
    expect(result.rows[1].state).toBe('duplicate')
  })

  it('keeps inaccessible, unpublished and ambiguous inputs pending', () => {
    const rows: ResolvedProblemSelection[] = [
      { clientKey: 'a', platform: 'luogu', problemId: 'P2', status: 'not_found' },
      { ...found, clientKey: 'b', status: 'not_published', message: '未发布' },
      { clientKey: 'c', platform: 'luogu', problemId: 'P3', status: 'identity_conflict' },
    ]
    const result = prepareProblemSelection(rows, [], false)
    expect(result.accepted).toHaveLength(0)
    expect(result.remainingProblemIds).toEqual(['P2', 'P1001', 'P3'])
  })

  it('accepts a ready assessment without claiming persistence', () => {
    const ready = { ...found, problem: { ...found.problem!, stableData: { slot: 'STABLE' as const, graphHash: 'hash', fencingToken: 0, mode: 'acm' as const } } }
    const result = prepareProblemSelection([ready], [], true)
    expect(result.accepted).toHaveLength(1)
    expect(result.rows[0].message).toContain('仍需保存')
  })

  it('keeps all business UIs on the shared VJudge-style reference selector', () => {
    const sources = [
      read('../contest/ui/ContestFormModal.tsx'),
      read('../assignment/ui/AssignmentWorkspace.tsx'),
      read('../training-session/ui/TrainingSetupDialog.tsx'),
      read('../training-session/ui/TrainingSessionDesigner.tsx'),
      read('../problem/ui/ProblemListDetailPage.tsx'),
      read('../training-session/ui/TrainingSessionWorkspace.tsx'),
    ]
    for (const source of sources) expect(source).toContain('ProblemReferenceSelector')
    expect(read('../training-session/ui/TrainingSessionListPage.tsx')).toContain('<TrainingSetupDialog')
    const combined = sources.join('\n')
    expect(combined).not.toContain('从题单选择')
    expect(combined).not.toContain('浏览题库')
    expect(combined).not.toContain('/api/resolve-problems')
    expect(combined).not.toContain('/entries/resolve')
    expect(read('../problem/ui/ProblemListDetailPage.tsx')).toContain('requireStable={false}')
    expect(read('../training-session/ui/TrainingSetupDialog.tsx')).toContain('requireStable={false}')
    expect(read('../training-session/ui/TrainingSessionDesigner.tsx')).toContain('requireStable={false}')
    expect(read('../contest/ui/ContestFormModal.tsx')).not.toContain('requireStable={false}')
    expect(read('../assignment/ui/AssignmentWorkspace.tsx')).not.toContain('requireStable={false}')
    const selector = read('./ui/ProblemReferenceSelector.tsx')
    expect(selector).toContain('window.setTimeout')
    expect(selector).toContain('400')
    expect(selector).toContain('ProblemReferenceResult')
    expect(selector).toContain('批量添加题目')
    expect(read('./ui/ProblemReferenceLink.tsx')).toContain('/problems/')
    expect(read('./index.ts')).not.toContain('QuickProblemInput')
  })
})
