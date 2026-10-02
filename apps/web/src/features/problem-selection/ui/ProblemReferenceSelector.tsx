'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { OJ_PLATFORMS_NO_ALL, normalizeOjPlatformKey } from '@/lib/oj-platforms'
import { useAuth } from '@/features/auth'
import { resolveProblemSelection } from '../api/problemSelectionApi'
import { parseProblemReferenceImport } from '../model/problemReferenceImport'
import {
  orderProblemSelectionResults,
  prepareProblemSelection,
  problemSelectionInputError,
  problemReferenceAddReceipt,
  ProblemReferenceOperation,
  type AddProblemReferences,
  type ProblemDataRequirement,
  type ProblemReferenceAddReceipt,
  type SelectedProblemReference,
} from '../model/problemSelection'
import { useProblemReferenceResolver } from '../model/useProblemReferenceResolver'
import { ProblemReferenceResult } from './ProblemReferenceResult'
import styles from './ProblemReferenceSelector.module.css'

export interface EditableProblemReference {
  platform: string
  problemId: string
  alias?: string | null
}

export interface ProblemReferenceSelectorProps {
  existingProblemIds?: Iterable<string>
  onAdd: AddProblemReferences
  /** When supplied, “编辑” replaces the whole current business list from text. */
  editableReferences?: readonly EditableProblemReference[]
  onReplace?: AddProblemReferences
  /** Change when a destination stage, section or other business target changes. */
  contextKey?: string
  autoFocus?: boolean
  disabled?: boolean
  label?: string
  dataRequirement?: ProblemDataRequirement
  /** null hides the alias field. */
  aliasLabel?: string | null
  allowTextEdit?: boolean
}

export function ProblemReferenceSelector(props: ProblemReferenceSelectorProps) {
  const { user, sessionKey } = useAuth()
  const pathname = usePathname()
  const scope = JSON.stringify([sessionKey, pathname, props.contextKey])
  return <ReferenceEditor key={scope} {...props} scope={scope} accountId={user?.userId || 'anonymous'} disabled={props.disabled || !sessionKey} />
}

function ReferenceEditor({
  existingProblemIds,
  onAdd,
  editableReferences,
  onReplace,
  autoFocus = false,
  disabled = false,
  label = '添加题目',
  dataRequirement = 'stable',
  aliasLabel = null,
  allowTextEdit = true,
  scope,
  accountId,
}: ProblemReferenceSelectorProps & { scope: string; accountId: string }) {
  const storageKey = `problem-selection:last-platform:${accountId}`
  const [platform, setPlatform] = useState('carits')
  const [problemId, setProblemId] = useState('')
  const [alias, setAlias] = useState('')
  const [composing, setComposing] = useState(false)
  const [editingRow, setEditingRow] = useState(false)
  const [textMode, setTextMode] = useState(false)
  const [textValue, setTextValue] = useState('')
  const [textBusy, setTextBusy] = useState(false)
  const [textError, setTextError] = useState('')
  const [commitRequested, setCommitRequested] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(false)
  const operation = useRef(new ProblemReferenceOperation())
  const existing = useMemo(() => [...(existingProblemIds || [])], [existingProblemIds])
  const latest = useRef({ existing, disabled, dataRequirement, onAdd, onReplace })
  latest.current = { existing, disabled, dataRequirement, onAdd, onReplace }

  const trimmed = problemId.trim()
  const inputError = trimmed ? problemSelectionInputError([trimmed]) : null
  const resolution = useProblemReferenceResolver({
    items: trimmed ? [{ clientKey: 'single', platform, problemId: trimmed }] : [],
    enabled: editingRow && !disabled && !composing && !textMode && !inputError,
    contextKey: scope,
  })
  const preview = prepareProblemSelection(resolution.items, existing, dataRequirement)
  const row = preview.rows[0]
  const ready = row?.state === 'ready' ? row.result.problem : undefined

  useEffect(() => {
    mounted.current = true
    const gate = operation.current
    try {
      const saved = normalizeOjPlatformKey(window.localStorage.getItem(storageKey) || '')
      if (saved && OJ_PLATFORMS_NO_ALL.some(item => item.value === saved)) setPlatform(saved)
    } catch { /* Platform memory is optional. */ }
    return () => { mounted.current = false; gate.cancel() }
  }, [storageKey])

  useEffect(() => {
    if (disabled) {
      operation.current.cancel()
      setAdding(false)
      setTextBusy(false)
    }
  }, [disabled])

  const changePlatform = (next: string) => {
    const canonical = normalizeOjPlatformKey(next)
    if (!canonical) return
    setPlatform(canonical)
    setAddError('')
    setNotice('')
    setCommitRequested(false)
    try { window.localStorage.setItem(storageKey, canonical) } catch { /* Storage is optional. */ }
  }

  const runBusinessAction = async (
    key: string,
    references: SelectedProblemReference[],
    action: AddProblemReferences,
  ): Promise<ProblemReferenceAddReceipt | undefined> => {
    if (latest.current.disabled || operation.current.isRunning(key)) return
    const ticket = operation.current.begin(key)
    const current = () => mounted.current && ticket.isCurrent() && !latest.current.disabled
    if (key === 'replace') setTextBusy(true)
    else setAdding(true)
    try {
      const receipt = problemReferenceAddReceipt(
        references,
        await action(references, { signal: ticket.signal, isCurrent: current }),
      )
      if (!current()) return
      return receipt
    } catch (error) {
      if (current()) throw error
    } finally {
      if (current()) {
        if (key === 'replace') setTextBusy(false)
        else setAdding(false)
      }
      operation.current.finish(ticket)
    }
  }

  const addCurrent = async () => {
    if (!ready || resolution.resolving || adding) return
    setAddError('')
    try {
      const reference: SelectedProblemReference = { problem: ready, alias: alias.trim() || undefined }
      const receipt = await runBusinessAction('add', [reference], latest.current.onAdd)
      if (!receipt || !mounted.current) return
      if (!receipt.acceptedIds.includes(ready.id)) {
        setAddError(receipt.rejected?.find(item => item.id === ready.id)?.message || '未加入当前列表，请重试')
        return
      }
      setProblemId('')
      setAlias('')
      setEditingRow(false)
      setCommitRequested(false)
      setNotice('题目已加入当前列表。')
    } catch (error) {
      if (mounted.current) setAddError(error instanceof Error ? error.message : '添加失败，请重试')
    }
  }

  useEffect(() => {
    if (!commitRequested) return
    if (resolution.resolving) return
    if (ready) {
      setCommitRequested(false)
      void addCurrent()
      return
    }
    if (row || resolution.error || inputError) setCommitRequested(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitRequested, ready, resolution.resolving, row, resolution.error, inputError])

  const requestCommit = () => {
    if (!trimmed || inputError || disabled || adding) return
    if (ready && !resolution.resolving) {
      void addCurrent()
      return
    }
    setCommitRequested(true)
    void resolution.resolve()
  }

  const beginTextEdit = () => {
    const rows = editableReferences || []
    setTextValue(rows.map(item => [item.platform, item.problemId, item.alias || ''].filter((_, index) => index < 2 || item.alias).join(' | ')).join('\n'))
    setTextError('')
    setTextMode(true)
    setEditingRow(false)
    setNotice('')
  }

  const applyTextEdit = async () => {
    if (!onReplace || textBusy || disabled) return
    const parsed = parseProblemReferenceImport(textValue)
    if (parsed.error) { setTextError(parsed.error); return }
    const invalid = parsed.rows.find(item => item.error)
    if (invalid) { setTextError(`第 ${invalid.lineNumber} 行：${invalid.error}`); return }
    if (!parsed.validRows.length) {
      try {
        const receipt = await runBusinessAction('replace', [], onReplace)
        if (receipt && mounted.current) { setTextMode(false); setTextError('') }
      } catch (error) {
        if (mounted.current) setTextError(error instanceof Error ? error.message : '更新失败，请重试')
      }
      return
    }

    const items = parsed.validRows.map(item => ({
      clientKey: item.clientKey,
      platform: item.platform!,
      problemId: item.problemId,
    }))
    const ticket = operation.current.begin('text-resolve')
    const current = () => mounted.current && ticket.isCurrent() && !latest.current.disabled
    setTextBusy(true)
    setTextError('')
    try {
      const response = await resolveProblemSelection({ items }, { signal: ticket.signal })
      if (!current()) return
      if (!response.ok) throw response.error
      const ordered = orderProblemSelectionResults(items, response.data.items)
      const assessment = prepareProblemSelection(ordered, [], dataRequirement)
      const blocked = assessment.rows.find(item => item.state !== 'ready')
      if (blocked) {
        const source = parsed.rows.find(item => item.clientKey === blocked.result.clientKey)
        setTextError(`第 ${source?.lineNumber || '?'} 行：${blocked.message}`)
        return
      }
      const sourceByKey = new Map(parsed.rows.map(item => [item.clientKey, item]))
      const references: SelectedProblemReference[] = assessment.rows.map(item => ({
        problem: item.result.problem!,
        alias: sourceByKey.get(item.result.clientKey)?.alias || undefined,
        lineNumber: sourceByKey.get(item.result.clientKey)?.lineNumber,
      }))
      operation.current.finish(ticket)
      const receipt = await runBusinessAction('replace', references, onReplace)
      if (!receipt || !mounted.current) return
      if (receipt.acceptedIds.length !== references.length) {
        setTextError(receipt.rejected?.[0]?.message || '部分题目未能更新，请检查后重试')
        return
      }
      setTextMode(false)
      setTextError('')
      setNotice('题目列表已更新。')
    } catch (error) {
      if (current()) setTextError(error instanceof Error ? error.message : '解析题目失败，请重试')
    } finally {
      if (current()) setTextBusy(false)
      operation.current.finish(ticket)
    }
  }

  return <section className={styles.root} aria-label={label} data-testid="problem-reference-selector">
    <div className={styles.toolbar}>
      {!editingRow && !textMode && <Button type="button" variant="secondary" onClick={() => { setEditingRow(true); setAddError(''); setNotice('') }} disabled={disabled || adding}>＋ 添加一道题目</Button>}
      {allowTextEdit && editableReferences && onReplace && !textMode && <Button type="button" variant="ghost" onClick={beginTextEdit} disabled={disabled || adding}>编辑</Button>}
      <span className={styles.hint}>仅使用系统题库中的可用题目</span>
    </div>

    {editingRow && !textMode && <div className={`${styles.composer} ${aliasLabel ? '' : styles.composerWithoutAlias}`}>
      <Select aria-label="题目平台" value={platform} onChange={event => changePlatform(event.target.value)} disabled={disabled || adding}>
        {OJ_PLATFORMS_NO_ALL.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </Select>
      <Input
        aria-label="题号"
        value={problemId}
        autoFocus={autoFocus || editingRow}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled || adding}
        aria-invalid={Boolean(inputError)}
        placeholder={platform === 'carits' ? '题号，例如 10086' : platform === 'luogu' ? '题号，例如 P1001' : platform === 'codeforces' ? '题号，例如 2036G' : '输入原始题号'}
        onChange={event => { setProblemId(event.target.value); setAddError(''); setNotice(''); setCommitRequested(false) }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onKeyDown={event => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (!event.nativeEvent.isComposing && !composing && !event.repeat) requestCommit()
        }}
      />
      {aliasLabel && <Input aria-label={aliasLabel} value={alias} maxLength={50} placeholder={aliasLabel} disabled={disabled || adding} onChange={event => setAlias(event.target.value)} onKeyDown={event => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        if (!event.nativeEvent.isComposing && !event.repeat) requestCommit()
      }} />}
      <Button type="button" onClick={requestCommit} loading={adding || commitRequested && resolution.resolving} disabled={disabled || adding || !trimmed || Boolean(inputError)}>完成</Button>
      <Button type="button" variant="ghost" onClick={() => { setEditingRow(false); setProblemId(''); setAlias(''); setCommitRequested(false); setAddError('') }} disabled={adding}>取消</Button>
      <div className={styles.inlineResult} role="status" aria-live="polite">
        <ProblemReferenceResult row={row} resolving={resolution.resolving} requestError={inputError || resolution.error} />
      </div>
    </div>}

    {textMode && <div className={styles.textEditor}>
      <div className={styles.textEditorHeader}><div><strong>编辑题目列表</strong><span>每行：平台 | 题号 | 别名（可选）</span></div></div>
      <Textarea aria-label="题目列表文本编辑" rows={Math.max(7, Math.min(18, (textValue.match(/\n/g)?.length || 0) + 3))} value={textValue} disabled={disabled || textBusy} placeholder={'QOJ | 9422 | A\nCodeForces | 242E | B\n洛谷 | P2023 | C'} onChange={event => { setTextValue(event.target.value); setTextError('') }} />
      {textError && <p className={styles.error} role="alert">{textError}</p>}
      <div className={styles.textActions}>
        <Button type="button" variant="secondary" onClick={() => { setTextMode(false); setTextError('') }} disabled={textBusy}>取消</Button>
        <Button type="button" onClick={() => void applyTextEdit()} loading={textBusy} disabled={disabled || textBusy}>确认</Button>
      </div>
    </div>}

    {addError && <p className={styles.error} role="alert">{addError}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
  </section>
}
