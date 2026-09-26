'use client'

import { useEffect, useRef, useState } from 'react'
import { Textarea } from '@/components/ui/FormControls'
import { transitionSubmissionDraft } from '../model/submission-draft'
import styles from './SubmissionCodeEditor.module.css'

type EditorViewType = import('@codemirror/view').EditorView

export interface SubmissionCodeEditorProps {
  value: string
  onChange: (value: string) => void
  onLocalDraftRestore?: (value: string) => void
  language: string
  draftKey: string
  readOnly?: boolean
  minHeight?: number
  ariaLabel?: string
  id?: string
  className?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-labelledby'?: string
}

function storageKey(draftKey: string, language: string) {
  return `submission-draft:v1:${draftKey}:${language}`
}

export function persistSubmissionDraft(draftKey: string, language: string, value: string) {
  if (typeof window === 'undefined') return
  try {
    if (value) window.localStorage.setItem(storageKey(draftKey, language), value)
    else window.localStorage.removeItem(storageKey(draftKey, language))
  } catch {
    // Browser storage is a best-effort safety net.
  }
}

export function clearSubmissionDraft(draftKey: string, language: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storageKey(draftKey, language))
  } catch {
    // A successful server submission must not be reported as failed because local cleanup is unavailable.
  }
}

export function SubmissionCodeEditor({
  value,
  onChange,
  onLocalDraftRestore,
  language,
  draftKey,
  readOnly = false,
  minHeight = 300,
  ariaLabel = '提交源码',
  id,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  'aria-labelledby': ariaLabelledBy,
}: SubmissionCodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorViewType | null>(null)
  const onChangeRef = useRef(onChange)
  const onLocalDraftRestoreRef = useRef(onLocalDraftRestore)
  const activeDraftKey = useRef<string | null>(null)
  const valueRef = useRef(value)
  const applyingExternalValue = useRef(false)
  const [fallback, setFallback] = useState(false)

  valueRef.current = value
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onLocalDraftRestoreRef.current = onLocalDraftRestore }, [onLocalDraftRestore])
  useEffect(() => {
    const nextKey = storageKey(draftKey, language)
    try {
      const nextValue = transitionSubmissionDraft(window.localStorage, activeDraftKey.current, nextKey, valueRef.current)
      activeDraftKey.current = nextKey
      if (nextValue !== valueRef.current) (onLocalDraftRestoreRef.current || onChangeRef.current)(nextValue)
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
  useEffect(() => () => {
    try {
      const latestValue = valueRef.current
      const key = storageKey(draftKey, language)
      if (latestValue) window.localStorage.setItem(key, latestValue)
      else window.localStorage.removeItem(key)
    } catch {
      // Best-effort flush: navigation must remain possible when storage is unavailable.
    }
  }, [draftKey, language])
  useEffect(() => {
    let cancelled = false
    async function mount() {
      try {
        const [{ EditorState }, { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter }, commands, search, autocomplete, languageSupport, cpp, python] = await Promise.all([
          import('@codemirror/state'), import('@codemirror/view'), import('@codemirror/commands'), import('@codemirror/search'), import('@codemirror/autocomplete'), import('@codemirror/language'), import('@codemirror/lang-cpp'), import('@codemirror/lang-python'),
        ])
        if (cancelled || !host.current) return
        const languageExtension = language === 'python3' ? python.python() : cpp.cpp()
        const contentAttributes: Record<string, string> = { 'aria-label': ariaLabel, spellcheck: 'false' }
        if (id) contentAttributes.id = id
        if (ariaDescribedBy) contentAttributes['aria-describedby'] = ariaDescribedBy
        if (ariaLabelledBy) contentAttributes['aria-labelledby'] = ariaLabelledBy
        if (ariaInvalid !== undefined) contentAttributes['aria-invalid'] = String(ariaInvalid)
        const initialValue = valueRef.current

        const state = EditorState.create({
          doc: initialValue,
          extensions: [
            lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), languageExtension,
            commands.history(), autocomplete.closeBrackets(), languageSupport.bracketMatching(),
            EditorView.lineWrapping,
            EditorState.readOnly.of(readOnly),
            EditorView.contentAttributes.of(contentAttributes),
            keymap.of([...autocomplete.closeBracketsKeymap, ...commands.defaultKeymap, ...commands.historyKeymap, ...(commands.indentWithTab ? [commands.indentWithTab] : []), ...search.searchKeymap]),
            EditorView.updateListener.of(update => { if (update.docChanged && !applyingExternalValue.current) onChangeRef.current(update.state.doc.toString()) }),
          ],
        })
        const mountedView = new EditorView({ state, parent: host.current })
        view.current = mountedView
        const latestValue = valueRef.current
        if (mountedView.state.doc.toString() !== latestValue) {
          applyingExternalValue.current = true
          try { mountedView.dispatch({ changes: { from: 0, to: mountedView.state.doc.length, insert: latestValue } }) }
          finally { applyingExternalValue.current = false }
        }
      } catch {
        if (!cancelled) setFallback(true)
      }
    }
    void mount()
    return () => { cancelled = true; view.current?.destroy(); view.current = null }
  }, [ariaDescribedBy, ariaInvalid, ariaLabel, ariaLabelledBy, id, language, readOnly])

  useEffect(() => {
    const current = view.current
    if (!current || current.state.doc.toString() === value) return
    applyingExternalValue.current = true
    try { current.dispatch({ changes: { from: 0, to: current.state.doc.length, insert: value } }) }
    finally { applyingExternalValue.current = false }
  }, [value])

  const heightClass = minHeight >= 420 ? styles.height420 : minHeight >= 360 ? styles.height360 : styles.height300
  if (fallback) return <Textarea id={id} className={`${styles.fallback} ${heightClass} ${className || ''}`.trim()} value={value} onChange={event => onChange(event.target.value)} readOnly={readOnly} spellCheck={false} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy} aria-invalid={ariaInvalid} />
  return <div ref={host} className={`${styles.editor} ${heightClass} ${className || ''}`.trim()} data-language={language} />
}
