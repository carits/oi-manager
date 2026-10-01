'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/FormControls'
import { OJ_PLATFORMS_NO_ALL, normalizeOjPlatformKey } from '@/lib/oj-platforms'
import { useAuth } from '@/features/auth'
import {
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
import { ProblemBatchAddDialog } from './ProblemBatchAddDialog'
import { ProblemReferenceResult } from './ProblemReferenceResult'
import styles from './ProblemReferenceSelector.module.css'

export interface ProblemReferenceSelectorProps {
  existingProblemIds?: Iterable<string>
  onAdd: AddProblemReferences
  /** Change when a destination stage, section or other business target changes. */
  contextKey?: string
  autoFocus?: boolean
  disabled?: boolean
  label?: string
  dataRequirement?: ProblemDataRequirement
  allowBatch?: boolean
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
  autoFocus = false,
  disabled = false,
  label = '按题号添加',
  dataRequirement = 'stable',
  allowBatch = true,
  scope,
  accountId,
}: ProblemReferenceSelectorProps & { scope: string; accountId: string }) {
  const fieldId = useId()
  const storageKey = `problem-selection:last-platform:${accountId}`
  const [platform, setPlatform] = useState('carits')
  const [problemId, setProblemId] = useState('')
  const [composing, setComposing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [notice, setNotice] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const mounted = useRef(false)
  const addOperation = useRef(new ProblemReferenceOperation())
  const existing = useMemo(() => [...(existingProblemIds || [])], [existingProblemIds])
  const latest = useRef({ existing, disabled, dataRequirement, onAdd })
  latest.current = { existing, disabled, dataRequirement, onAdd }
  const trimmed = problemId.trim()
  const inputError = trimmed ? problemSelectionInputError([trimmed]) : null
  const resolution = useProblemReferenceResolver({
    items: trimmed ? [{ clientKey: 'single', platform, problemId: trimmed }] : [],
    enabled: !disabled && !composing && !batchOpen && !inputError,
    contextKey: scope,
  })
  const preview = prepareProblemSelection(resolution.items, existing, dataRequirement)
  const row = preview.rows[0]
  const ready = row?.state === 'ready' ? row.result.problem : undefined

  useEffect(() => {
    mounted.current = true
    const operation = addOperation.current
    try {
      const saved = normalizeOjPlatformKey(window.localStorage.getItem(storageKey) || '')
      if (saved && OJ_PLATFORMS_NO_ALL.some(item => item.value === saved)) setPlatform(saved)
    } catch { /* Platform memory is optional. */ }
    return () => { mounted.current = false; operation.cancel() }
  }, [storageKey])

  useEffect(() => {
    if (disabled) { addOperation.current.cancel(); setAdding(false) }
  }, [disabled])

  const changePlatform = (next: string) => {
    const canonical = normalizeOjPlatformKey(next)
    if (!canonical) return
    setPlatform(canonical)
    setAddError('')
    setNotice('')
    try { window.localStorage.setItem(storageKey, canonical) } catch { /* Storage is optional. */ }
  }

  // One synchronous lock is shared by the single and batch entry points.
  const performAdd = async (references: SelectedProblemReference[]): Promise<ProblemReferenceAddReceipt | undefined> => {
    if (latest.current.disabled || addOperation.current.isRunning('add')) return
    const ticket = addOperation.current.begin('add')
    const current = () => mounted.current && ticket.isCurrent() && !latest.current.disabled
    setAdding(true)
    try {
      const existingIds = new Set(latest.current.existing)
      const candidates = references.filter(reference => !existingIds.has(reference.problem.id))
      const assessment = prepareProblemSelection(candidates.map(reference => ({
        clientKey: reference.problem.id,
        platform: reference.problem.platform,
        problemId: reference.problem.problemId,
        status: 'resolved',
        problem: reference.problem,
      })), [], latest.current.dataRequirement)
      const acceptedIds = new Set(assessment.accepted.map(problem => problem.id))
      const acceptedReferences = candidates.filter(reference => acceptedIds.has(reference.problem.id))
      const receipt = acceptedReferences.length
        ? problemReferenceAddReceipt(acceptedReferences, await latest.current.onAdd(acceptedReferences, { signal: ticket.signal, isCurrent: current }))
        : { acceptedIds: [] as string[] }
      if (!current()) return
      return {
        acceptedIds: [
          ...references.filter(reference => existingIds.has(reference.problem.id)).map(reference => reference.problem.id),
          ...receipt.acceptedIds,
        ],
        rejected: [
          ...(receipt.rejected || []),
          ...assessment.rows.filter(item => item.state === 'blocked').map(item => ({ id: item.result.problem!.id, message: item.message })),
        ],
      }
    } catch (error) {
      if (current()) throw error
    } finally {
      if (current()) setAdding(false)
      addOperation.current.finish(ticket)
    }
  }

  const add = async () => {
    if (!ready || resolution.resolving) return
    setAddError('')
    try {
      const receipt = await performAdd([{ problem: ready }])
      if (!receipt || !mounted.current) return
      if (!receipt.acceptedIds.includes(ready.id)) {
        setAddError(receipt.rejected?.find(item => item.id === ready.id)?.message || '未选入当前表单，请重试')
        return
      }
      setProblemId('')
      setNotice('已选入当前表单，仍需保存。')
    } catch (error) {
      if (mounted.current) setAddError(error instanceof Error ? error.message : '选入失败，输入已保留，请重试')
    }
  }

  return <section className={styles.root} aria-label={label} data-testid="problem-reference-selector">
    <div className={styles.row}>
      <label className={styles.field} htmlFor={`${fieldId}-platform`}>平台
        <Select id={`${fieldId}-platform`} aria-label="题目平台" value={platform} onChange={event => changePlatform(event.target.value)} disabled={disabled || adding || batchOpen}>
          {OJ_PLATFORMS_NO_ALL.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
      </label>
      <label className={styles.field} htmlFor={`${fieldId}-number`}>题号
        <Input id={`${fieldId}-number`} className={styles.input} aria-label="题号" aria-describedby={`${fieldId}-result`} aria-invalid={Boolean(inputError)} value={problemId} autoFocus={autoFocus} autoComplete="off" spellCheck={false}
          disabled={disabled || adding || batchOpen}
          placeholder={platform === 'carits' ? '例如 10086' : platform === 'luogu' ? '例如 P1001' : platform === 'codeforces' ? '例如 2036G' : '输入原始题号'}
          onChange={event => { setProblemId(event.target.value); setAddError(''); setNotice('') }}
          onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
          onKeyDown={event => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            if (!event.nativeEvent.isComposing && !composing && !event.repeat) void resolution.resolve()
          }}
        />
      </label>
      <div className={styles.field}>检索结果
        <div id={`${fieldId}-result`} className={styles.resultBox} role="status" aria-live="polite">
          <ProblemReferenceResult row={row} resolving={resolution.resolving} requestError={inputError || resolution.error} />
        </div>
      </div>
      <Button type="button" onClick={() => void add()} loading={adding && !batchOpen} disabled={disabled || adding || batchOpen || !ready || resolution.resolving}>添加</Button>
    </div>
    {addError && <p className={styles.error} role="alert">{addError}</p>}
    {notice && <p className={styles.hint} role="status">{notice}</p>}
    <div className={styles.actions}>
      {resolution.error && <Button type="button" variant="secondary" size="sm" disabled={disabled || adding} onClick={() => void resolution.resolve()}>重新检索</Button>}
      {allowBatch && <Button type="button" variant="secondary" size="sm" disabled={disabled || adding} onClick={() => setBatchOpen(true)}>批量添加题目</Button>}
      <p className={styles.hint}>仅检索系统已有题目，不从外部 OJ 拉取。</p>
    </div>
    {allowBatch && batchOpen && <ProblemBatchAddDialog
      onClose={() => setBatchOpen(false)}
      existingProblemIds={existing} dataRequirement={dataRequirement} contextKey={scope}
      disabled={disabled} adding={adding} onAdd={performAdd}
    />}
  </section>
}
