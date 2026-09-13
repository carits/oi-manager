'use client'

import { useEffect, useRef, useState } from 'react'
import { Textarea } from '@/components/ui/FormControls'
import { transitionSubmissionDraft } from '../model/submission-draft'
import styles from './SubmissionCodeEditor.module.css'

type EditorViewType = import('@codemirror/view').EditorView

export interface SubmissionCodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: string
  draftKey: string
  readOnly?: boolean
  minHeight?: number
  ariaLabel?: string
}

function storageKey(draftKey: string, language: string) {
  return `submission-draft:v1:${draftKey}:${language}`
}

export function clearSubmissionDraft(draftKey: string, language: string) {
  if (typeof window !== 'undefined') window.localStorage.removeItem(storageKey(draftKey, language))
}

export function SubmissionCodeEditor({ value, onChange, language, draftKey, readOnly = false, minHeight = 300, ariaLabel = '提交源码' }: SubmissionCodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorViewType | null>(null)
  const onChangeRef = useRef(onChange)
  const activeDraftKey = useRef<string | null>(null)
  const valueRef = useRef(value)
  const [fallback, setFallback] = useState(false)

  valueRef.current = value
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => {
    const nextKey = storageKey(draftKey, language)
    try {
      const nextValue = transitionSubmissionDraft(window.localStorage, activeDraftKey.current, nextKey, valueRef.current)
      activeDraftKey.current = nextKey
      if (nextValue !== valueRef.current) onChangeRef.current(nextValue)
    } catch {
      activeDraftKey.current = nextKey
    }
  }, [draftKey, language])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (value) window.localStorage.setItem(storageKey(draftKey, language), value)
        else window.localStorage.removeItem(storageKey(draftKey, language))
      } catch {
        // The editor remains usable when browser storage is unavailable.
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [draftKey, language, value])

  useEffect(() => {
    let cancelled = false
    async function mount() {
      try {
        const [{ EditorState }, { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter }, commands, search, autocomplete, languageSupport, cpp, python] = await Promise.all([
          import('@codemirror/state'), import('@codemirror/view'), import('@codemirror/commands'), import('@codemirror/search'), import('@codemirror/autocomplete'), import('@codemirror/language'), import('@codemirror/lang-cpp'), import('@codemirror/lang-python'),
        ])
        if (cancelled || !host.current) return
        const languageExtension = language === 'python3' ? python.python() : cpp.cpp()
        const state = EditorState.create({
          doc: value,
          extensions: [
            lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), languageExtension,
            commands.history(), autocomplete.closeBrackets(), languageSupport.bracketMatching(),
            EditorView.lineWrapping,
            EditorState.readOnly.of(readOnly),
            EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false' }),
            keymap.of([...autocomplete.closeBracketsKeymap, ...commands.defaultKeymap, ...commands.historyKeymap, ...(commands.indentWithTab ? [commands.indentWithTab] : []), ...search.searchKeymap]),
            EditorView.updateListener.of(update => { if (update.docChanged) onChangeRef.current(update.state.doc.toString()) }),
          ],
        })
        view.current = new EditorView({ state, parent: host.current })
      } catch {
        if (!cancelled) setFallback(true)
      }
    }
    void mount()
    return () => { cancelled = true; view.current?.destroy(); view.current = null }
  // Recreate only when language/read-only identity changes; value is synchronized below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly, ariaLabel])

  useEffect(() => {
    const current = view.current
    if (!current || current.state.doc.toString() === value) return
    current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } })
  }, [value])

  const heightClass = minHeight >= 420 ? styles.height420 : minHeight >= 360 ? styles.height360 : styles.height300
  if (fallback) return <Textarea className={`${styles.fallback} ${heightClass}`} value={value} onChange={event => onChange(event.target.value)} readOnly={readOnly} spellCheck={false} aria-label={ariaLabel} />
  return <div ref={host} className={`${styles.editor} ${heightClass}`} data-language={language} />
}
