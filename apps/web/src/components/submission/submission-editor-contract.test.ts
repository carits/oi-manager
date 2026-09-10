import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('shared submission editor product contract', () => {
  const editor = fs.readFileSync(new URL('./SubmissionCodeEditor.tsx', import.meta.url), 'utf8')

  it('loads CodeMirror on the client and keeps a usable textarea fallback', () => {
    expect(editor).toContain("import('@codemirror/state')")
    expect(editor).toContain("import('@codemirror/view')")
    expect(editor).toContain('setFallback(true)')
    expect(editor).toContain('<Textarea')
  })

  it('isolates language drafts and clears them after a successful submission', () => {
    expect(editor).toContain('submission-draft:v1:')
    expect(editor).toContain('draftKey, language, value')
    expect(editor).toContain('clearSubmissionDraft')
  })

  it('provides the expected coding affordances without changing submission IO', () => {
    expect(editor).toContain('lineNumbers()')
    expect(editor).toContain('indentWithTab')
    expect(editor).toContain('search.searchKeymap')
    expect(editor).not.toContain('inputFilename')
    expect(editor).not.toContain('outputFilename')
  })
})
