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
    const ids = parseProblemIds(Array.from({ length: 120 }, (_, index) => `P${index}`).join(' '))
    expect(ids).toHaveLength(120)
    expect(problemSelectionInputError(ids)).toContain('未截断')
    expect(problemSelectionInputError(ids.slice(0, 100))).toBeNull()
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
  it('keeps all six business entry points on the shared selector', () => {
    const paths = [
      '../contest/ui/ContestFormModal.tsx', '../assignment/ui/AssignmentWorkspace.tsx',
      '../training-session/ui/TrainingSetupDialog.tsx', '../training-session/ui/TrainingSessionDesigner.tsx',
      '../problem/ui/ProblemListDetailPage.tsx', '../training-session/ui/TrainingSessionWorkspace.tsx',
    ]
    const sources = paths.map(read)
    for (const source of sources) {
      expect(source).toContain('ProblemReferenceSelector')
      expect(source).not.toContain('QuickProblemInput')
      expect(source).not.toContain('/api/resolve-problems')
      expect(source).not.toContain('/entries/resolve')
    }
    for (const source of sources.slice(2)) expect(source).toContain('requireStable={false}')
    for (const source of sources.slice(0, 2)) expect(source).not.toContain('requireStable={false}')
    expect(read('./index.ts')).not.toContain('QuickProblemInput')
    expect(read('./ui/ProblemReferenceSelector.tsx')).toContain('useProblemReferenceResolver')
    expect(read('./model/useProblemReferenceResolver.ts')).toContain('PROBLEM_REFERENCE_DEBOUNCE_MS = 400')
    expect(read('./ui/ProblemReferenceSelector.tsx')).toContain('批量添加题目')
    expect(read('./ui/ProblemReferenceLink.tsx')).toContain('/problems/')
    expect(read('../training-session/ui/TrainingSessionListPage.tsx')).toContain('<TrainingSetupDialog')
    expect(sources[3]).toContain('operation.isCurrent()')
    expect(sources[3]).toContain('acceptedIds: details.map')
    expect(sources[3]).toContain('contextKey=')
  })
})
