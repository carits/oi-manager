'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/FormControls'
import { OJ_PLATFORMS_NO_ALL, normalizeOjPlatformKey } from '@/lib/oj-platforms'
import { useAuth } from '@/features/auth'
import { resolveProblemSelection } from '../api/problemSelectionApi'
import {
  prepareProblemSelection,
  problemSelectionInputError,
  type SelectedCanonicalProblem,
} from '../model/problemSelection'
import { ProblemBatchAddDialog } from './ProblemBatchAddDialog'
import { ProblemReferenceResult } from './ProblemReferenceResult'
import styles from './ProblemReferenceSelector.module.css'

export interface ProblemReferenceSelectorProps {
  existingProblemIds?: Iterable<string>
  onAdd: (problems: SelectedCanonicalProblem[]) => void | Promise<void>
  autoFocus?: boolean
  disabled?: boolean
  label?: string
  requireStable?: boolean
  allowBatch?: boolean
}

export function ProblemReferenceSelector({
  existingProblemIds,
  onAdd,
  autoFocus = true,
  disabled,
  label = '按题号添加',
  requireStable = true,
  allowBatch = true,
}: ProblemReferenceSelectorProps) {
  const { user, sessionKey } = useAuth()
  const storageKey = `problem-selection:last-platform:${user?.userId || 'anonymous'}`
  const [platform, setPlatform] = useState('carits')
  const [problemId, setProblemId] = useState('')
  const [result, setResult] = useState<Awaited<ReturnType<typeof resolveProblemSelection>> extends { data: infer T } ? T : never>()
  const [lookupItem, setLookupItem] = useState<import('@oi-manager/contracts').ResolvedProblemSelection | null>(null)
  const [resolving, setResolving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const requestRef = useRef(0)
  const contextRef = useRef(sessionKey)
  contextRef.current = sessionKey
  const existing = useMemo(() => [...(existingProblemIds || [])], [existingProblemIds])
  const trimmed = problemId.trim()
  const inputError = trimmed ? problemSelectionInputError([trimmed]) : null
  const preview = lookupItem ? prepareProblemSelection([lookupItem], existing, requireStable) : null
  const row = preview?.rows[0] || null
  const readyProblem = row?.state === 'ready' ? row.result.problem : undefined

  useEffect(() => {
    requestRef.current++
    setProblemId('')
    setLookupItem(null)
    setRequestError('')
    setResolving(false)
    let saved: string | null = null
    try { saved = normalizeOjPlatformKey(window.localStorage.getItem(storageKey) || '') } catch { /* storage is optional */ }
    setPlatform(saved && OJ_PLATFORMS_NO_ALL.some(item => item.value === saved) ? saved : 'carits')
  }, [storageKey, sessionKey])

  const changePlatform = (next: string) => {
    const canonical = normalizeOjPlatformKey(next)
    if (!canonical) return
    requestRef.current++
    setPlatform(canonical)
    setLookupItem(null)
    setRequestError('')
    try { window.localStorage.setItem(storageKey, canonical) } catch { /* storage is optional */ }
  }

  const lookup = async (candidate = problemId) => {
    const value = candidate.trim()
    if (!value || problemSelectionInputError([value]) || disabled) return
    const requestId = ++requestRef.current
    const context = sessionKey
    setResolving(true)
    setLookupItem(null)
    setRequestError('')
    try {
      const response = await resolveProblemSelection({
        items: [{ clientKey: String(requestId), platform, problemId: value }],
      })
      if (requestId !== requestRef.current || contextRef.current !== context) return
      if (!response.ok) {
        setRequestError(response.error.message)
        return
      }
      setLookupItem(response.data.items[0] || null)
    } catch (error) {
      if (requestId === requestRef.current && contextRef.current === context) {
        setRequestError(error instanceof Error ? error.message : '检索失败，请重试')
      }
    } finally {
      if (requestId === requestRef.current && contextRef.current === context) setResolving(false)
    }
  }

  useEffect(() => {
    if (!trimmed || inputError || disabled) {
      requestRef.current++
      setLookupItem(null)
      setResolving(false)
      if (!trimmed) setRequestError('')
      return
    }
    const timer = window.setTimeout(() => { void lookup(trimmed) }, 400)
    return () => window.clearTimeout(timer)
  // lookup intentionally reads the current platform/session and is guarded by requestRef.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, platform, sessionKey, disabled])

  const add = async () => {
    if (!readyProblem || adding || disabled) return
    setAdding(true)
    setRequestError('')
    try {
      await onAdd([readyProblem])
      requestRef.current++
      setProblemId('')
      setLookupItem(null)
      setResolving(false)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '选入当前表单失败，请重试')
    } finally {
      setAdding(false)
    }
  }

  return <section className={styles.root} aria-label={label} aria-busy={resolving || adding}>
    <div className={styles.row}>
      <Select aria-label="题目平台" value={platform} onChange={event => changePlatform(event.target.value)} disabled={disabled || adding}>
        {OJ_PLATFORMS_NO_ALL.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </Select>
      <Input
        className={styles.input}
        aria-label="题号"
        aria-invalid={Boolean(inputError)}
        value={problemId}
        autoFocus={autoFocus}
        disabled={disabled || adding}
        placeholder={platform === 'carits' ? '例如 10086' : platform === 'luogu' ? '例如 P1001' : platform === 'codeforces' ? '例如 2036G' : '输入原始题号'}
        onChange={event => { setProblemId(event.target.value); setLookupItem(null); setRequestError('') }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void (readyProblem ? add() : lookup())
          }
        }}
      />
      <div className={styles.resultBox} role="status">
        <ProblemReferenceResult row={row} resolving={resolving} requestError={inputError || requestError} />
      </div>
      <Button type="button" onClick={() => void add()} loading={adding} disabled={disabled || !readyProblem || resolving}>添加</Button>
    </div>
    <div className={styles.actions}>
      {allowBatch && <Button type="button" variant="secondary" size="sm" disabled={disabled || adding} onClick={() => setBatchOpen(true)}>批量添加题目</Button>}
      <p className={styles.hint}>只按平台 + 题号精确检索系统已有题目，不读取附加 OJ 绑定，不从外部拉取。</p>
    </div>
    {allowBatch && <ProblemBatchAddDialog
      isOpen={batchOpen}
      onClose={() => setBatchOpen(false)}
      platform={platform}
      onPlatformChange={changePlatform}
      existingProblemIds={existing}
      requireStable={requireStable}
      onAdd={onAdd}
    />}
  </section>
}
