import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseProblemCodes } from './model/problemSelection'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

describe('unified problem selection', () => {
  it('parses mixed separators, preserves order and removes duplicates', () => {
    expect(parseProblemCodes('P1001, P1002\nP1001；CF1A')).toEqual(['P1001', 'P1002', 'CF1A'])
  })

  it('caps a batch at 100 identifiers', () => {
    expect(parseProblemCodes(Array.from({ length: 120 }, (_, index) => `P${index}`).join(' '))).toHaveLength(100)
  })

  it('keeps all business UIs on the shared number-only entry', () => {
    const sources = [
      read('../contest/ui/ContestFormModal.tsx'),
      read('../assignment/ui/AssignmentWorkspace.tsx'),
      read('../training-session/ui/TrainingSetupDialog.tsx'),
      read('../training-session/ui/TrainingSessionDesigner.tsx'),
      read('../problem/ui/ProblemListDetailPage.tsx'),
    ]
    for (const source of sources) expect(source).toContain('QuickProblemInput')
    expect(read('../training-session/ui/TrainingSessionListPage.tsx')).toContain('<TrainingSetupDialog')
    const combined = sources.join('\n')
    expect(combined).not.toContain('从题单选择')
    expect(combined).not.toContain('浏览题库')
    expect(combined).not.toContain('/api/resolve-problems')
    expect(combined).not.toContain('/entries/resolve')
  })
})
