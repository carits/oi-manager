import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transitionSubmissionDraft } from './model/submission-draft'

describe('shared submission editor product contract', () => {
  const editor = fs.readFileSync(new URL('./ui/SubmissionCodeEditor.tsx', import.meta.url), 'utf8')
  const trainingEngine = fs.readFileSync(new URL('../training-session/ui/TrainingSessionWorkspace.tsx', import.meta.url), 'utf8')

  it('loads CodeMirror on the client and keeps a usable textarea fallback', () => {
    expect(editor).toContain("import('@codemirror/state')")
    expect(editor).toContain("import('@codemirror/view')")
    expect(editor).toContain('setFallback(true)')
    expect(editor).toContain('<Textarea')
  })

  it('isolates language drafts and clears them after a successful submission', () => {
    expect(editor).toContain('submission-draft:v1:')
    expect(editor).toContain('draftKey, language, value')
    expect(editor).toContain('transitionSubmissionDraft')
    expect(editor).not.toContain('if (!value && saved)')
    expect(editor).toContain('clearSubmissionDraft')
  })

  it('saves the old language and restores the target language without cross-contamination', () => {
    const values = new Map<string, string>([['submission-draft:v1:user:problem:python3', 'print(1)']])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    const cppKey = 'submission-draft:v1:user:problem:cpp17'
    const pythonKey = 'submission-draft:v1:user:problem:python3'
    expect(transitionSubmissionDraft(storage, cppKey, pythonKey, 'int main() {}')).toBe('print(1)')
    expect(values.get(cppKey)).toBe('int main() {}')
    expect(transitionSubmissionDraft(storage, pythonKey, cppKey, 'print(2)')).toBe('int main() {}')
    expect(values.get(pythonKey)).toBe('print(2)')
  })

  it('provides the expected coding affordances without changing submission IO', () => {
    expect(editor).toContain('lineNumbers()')
    expect(editor).toContain('indentWithTab')
    expect(editor).toContain('search.searchKeymap')
    expect(editor).toContain('autocomplete.closeBrackets()')
    expect(editor).toContain('languageSupport.bracketMatching()')
    expect(editor).toContain('commands.history()')
    expect(editor).not.toContain('inputFilename')
    expect(editor).not.toContain('outputFilename')
  })

  it('keeps Training Engine submission IO beside the shared editor and clears both drafts after success', () => {
    expect(trainingEngine).toContain('<SubmissionCodeEditor')
    expect(trainingEngine).toContain('<SubmissionIoFields')
    expect(trainingEngine).toContain('inputFilename: submissionIo.inputFilename')
    expect(trainingEngine).toContain('outputFilename: submissionIo.outputFilename')
    expect(trainingEngine).toContain('clearSubmissionDraft(editorDraftKey, language)')
    expect(trainingEngine).toContain("code: '', language, inputFilename: null, outputFilename: null")
    expect(trainingEngine).toContain('切换后会保存当前语言草稿')
  })
})
