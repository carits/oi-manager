import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ResolvedProblemSelection } from '@oi-manager/contracts'
import { parseProblemIds, prepareProblemSelection, problemSelectionInputError } from './model/problemSelection'
import { parseProblemReferenceImport } from './model/problemReferenceImport'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
const found: ResolvedProblemSelection = {
  clientKey: '1', platform: 'luogu', problemId: 'P1001', status: 'resolved',
  problem: { id: 'internal-1', platform: 'luogu', problemId: 'P1001', title: 'Example' },
}

describe('unified problem selection', () => {
  it('parses mixed-platform batch references without creating a discarded-column model', () => {
    const parsed = parseProblemReferenceImport([
      'CodeForces | 242E | 1 | A',
      '洛谷 | P2023 | 1 | B',
      'LibreOJ\t2570\tAF',
      'HDU｜1542｜AI',
    ].join('\n'))
    expect(parsed.error).toBeNull()
    expect(parsed.rows).toHaveLength(4)
    expect(parsed.rows.map(row => ({ platform: row.platform, problemId: row.problemId, alias: row.alias }))).toEqual([
      { platform: 'codeforces', problemId: '242E', alias: 'A' },
      { platform: 'luogu', problemId: 'P2023', alias: 'B' },
      { platform: 'libreoj', problemId: '2570', alias: 'AF' },
      { platform: 'hdu', problemId: '1542', alias: 'AI' },
    ])
    expect(parsed.rows.some(row => Object.prototype.hasOwnProperty.call(row, 'weight'))).toBe(false)
  })
  it('preserves the 40-row mixed-platform A-to-AN import exactly', () => {
    const parsed = parseProblemReferenceImport(`
CodeForces | 242E | 1 | A
洛谷 | P2023 | 1 | B
洛谷 | P4145 | 1 | C
洛谷 | P1471 | 1 | D
洛谷 | P3437 | 1 | E
CodeForces | 380C | 1 | F
CodeForces | 652D | 1 | G
CodeForces | 356A | 1 | H
CodeForces | 474F | 1 | I
CodeForces | 52C | 1 | J
CodeForces | 145E | 1 | K
洛谷 | P2572 | 1 | L
洛谷 | P4121 | 1 | M
CodeForces | 292E | 1 | N
CodeForces | 920F | 1 | O
CodeForces | 914D | 1 | P
CodeForces | 446C | 1 | Q
洛谷 | P4140 | 1 | R
洛谷 | P3875 | 1 | S
CodeForces | 1285E | 1 | T
CodeForces | 863E | 1 | U
CodeForces | 1555E | 1 | V
CodeForces | 438D | 1 | W
洛谷 | P4188 | 1 | X
洛谷 | P5142 | 1 | Y
洛谷 | P4072 | 1 | Z
CodeForces | 558E | 1 | AA
CodeForces | 580E | 1 | AB
CodeForces | 786B | 1 | AC
CodeForces | 817F | 1 | AD
CodeForces | 718C | 1 | AE
LibreOJ | 2570 | 1 | AF
LibreOJ | 3043 | 1 | AG
LibreOJ | 6576 | 1 | AH
HDU | 1542 | 1 | AI
HDU | 4578 | 1 | AJ
UniversalOJ | 467 | 1 | AK
QOJ | 7992 | 1 | AL
CodeForces | 1000F | 1 | AM
Baekjoon | 28057 | 1 | AN
`)
    expect(parsed.error).toBeNull()
    expect(parsed.rows).toHaveLength(40)
    expect(parsed.rows.map(row => row.alias)).toEqual([
      'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
      'AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM','AN',
    ])
    expect(parsed.rows[0]).toMatchObject({ platform: 'codeforces', problemId: '242E', alias: 'A' })
    expect(parsed.rows[31]).toMatchObject({ platform: 'libreoj', problemId: '2570', alias: 'AF' })
    expect(parsed.rows[36]).toMatchObject({ platform: 'universaloj', problemId: '467', alias: 'AK' })
    expect(parsed.rows[39]).toMatchObject({ platform: 'baekjoon', problemId: '28057', alias: 'AN' })
  })
  it('keeps every batch line and reports row-local format errors instead of silently dropping them', () => {
    const parsed = parseProblemReferenceImport('洛谷 | P1001 | A\nLuogu | P1001 | B\n未知OJ | 1 | C\n只有平台')
    expect(parsed.rows).toHaveLength(4)
    expect(parsed.rows[0]).toMatchObject({ platform: 'luogu', problemId: 'P1001', alias: 'A', error: null })
    expect(parsed.rows[1]).toMatchObject({ platform: 'luogu', problemId: 'P1001', alias: 'B', error: null })
    expect(parsed.rows[2].error).toContain('未注册')
    expect(parsed.rows[3].error).toContain('格式')
    expect(parsed.validRows).toHaveLength(2)
  })
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
  it('separates problem identity from activity readiness', () => {
    const assessment = prepareProblemSelection([found], [], 'stable')
    expect(assessment.accepted).toHaveLength(0)
    expect(assessment.rows[0].result.status).toBe('resolved')
    expect(assessment.rows[0].message).toContain('已找到')
    expect(assessment.remainingProblemIds).toEqual(['P1001'])
    expect(prepareProblemSelection([found], [], 'none').accepted).toEqual([found.problem])
    const evolving = { ...found, problem: { ...found.problem!, evolvingData: { slot: 'EVOLVING' as const, graphHash: 'evolving', fencingToken: 2, mode: 'oi' as const } } }
    expect(prepareProblemSelection([evolving], [], 'training').accepted).toEqual([evolving.problem])
    expect(prepareProblemSelection([found], [], 'training').rows[0].message).toContain('可用于训练的评测数据')
    expect(prepareProblemSelection([found], [], 'training').rows[0].message).not.toContain('Evolving')
  })
  it('deduplicates against current canonical IDs and within the batch', () => {
    expect(prepareProblemSelection([found], ['internal-1'], 'stable').rows[0].state).toBe('duplicate')
    const result = prepareProblemSelection([found, { ...found, clientKey: '2' }], [], 'none')
    expect(result.accepted).toHaveLength(1)
    expect(result.rows[1].state).toBe('duplicate')
  })
  it('keeps inaccessible, unpublished and ambiguous inputs pending', () => {
    const rows: ResolvedProblemSelection[] = [
      { clientKey: 'a', platform: 'luogu', problemId: 'P2', status: 'not_found' },
      { clientKey: 'b', platform: 'luogu', problemId: 'P1001', status: 'not_published', message: '未发布' },
      { clientKey: 'c', platform: 'luogu', problemId: 'P3', status: 'identity_conflict' },
    ]
    const result = prepareProblemSelection(rows, [], 'none')
    expect(result.accepted).toHaveLength(0)
    expect(result.remainingProblemIds).toEqual(['P2', 'P1001', 'P3'])
  })
  it('accepts a ready assessment without claiming persistence', () => {
    const ready = { ...found, problem: { ...found.problem!, stableData: { slot: 'STABLE' as const, graphHash: 'hash', fencingToken: 0, mode: 'acm' as const } } }
    const result = prepareProblemSelection([ready], [], 'stable')
    expect(result.accepted).toHaveLength(1)
    expect(result.rows[0].message).toContain('仍需保存')
  })
  it('keeps contest and training creation task-oriented instead of wizard/table driven', () => {
    const contest = read('../contest/ui/ContestFormModal.tsx')
    const training = read('../training-session/ui/TrainingSetupDialog.tsx')
    expect(contest).not.toContain('wizardSteps')
    expect(contest).not.toContain('TableRoot')
    expect(contest).toContain('ProblemListEditor')
    expect(contest).toContain('aliasLabel="别名"')
    expect(training).toContain('problemSetupSection')
    expect(training).toContain('ProblemListEditor')
    expect(training).toContain('aliasLabel="别名"')
  })
  it('uses the row-first list editor for creation and keeps the legacy selector only in older secondary entry points', () => {
    const creationPaths = [
      '../contest/ui/ContestFormModal.tsx',
      '../assignment/ui/AssignmentWorkspace.tsx',
      '../training-session/ui/TrainingSetupDialog.tsx',
      '../training-session/ui/TrainingSessionDesigner.tsx',
    ]
    const secondaryPaths = [
      '../problem/ui/ProblemListDetailPage.tsx',
      '../training-session/ui/TrainingSessionWorkspace.tsx',
    ]
    const creationSources = creationPaths.map(read)
    const secondarySources = secondaryPaths.map(read)
    for (const source of creationSources) {
      expect(source).toContain('ProblemListEditor')
      expect(source).not.toContain('ProblemReferenceSelector')
      expect(source).not.toContain('QuickProblemInput')
      expect(source).not.toContain('/api/resolve-problems')
      expect(source).not.toContain('/entries/resolve')
      expect(source).not.toContain('problemCode')
    }
    for (const source of secondarySources) expect(source).toContain('ProblemReferenceSelector')
    expect(creationSources[2]).toContain('dataRequirement="training"')
    expect(creationSources[3]).toContain('dataRequirement="training"')
    expect(secondarySources[0]).toContain('dataRequirement="none"')
    expect(secondarySources[1]).toContain('dataRequirement="training"')
    for (const source of [...creationSources, ...secondarySources]) expect(source).not.toContain('requireStable=')
    const editorSource = read('./ui/ProblemListEditor.tsx')
    expect(editorSource).toContain('＋ 添加一道题目')
    expect(editorSource).toContain('题目列表文本编辑')
    expect(editorSource).toContain('350')
    expect(editorSource).not.toContain('检索结果')
    expect(editorSource).not.toContain('重新检索')
    expect(editorSource).not.toContain('批量添加题目')
    expect(editorSource).not.toContain('>完成</Button>')
    expect(read('./index.ts')).toContain('ProblemListEditor')
    expect(read('./ui/ProblemReferenceLink.tsx')).toContain('problemReferenceHref(pathname, problem.id)')
    expect(read('../training-session/ui/TrainingSessionListPage.tsx')).toContain('<TrainingSetupDialog')
    expect(read('../training-session/ui/TrainingProblemChain.tsx')).toContain('<ProblemReferenceLink problem={problem.Problem}')
    expect(creationSources[3]).toContain('onReplace={replaceProblems}')
    expect(creationSources[3]).toContain('aliasLabel="别名"')
  })
})
