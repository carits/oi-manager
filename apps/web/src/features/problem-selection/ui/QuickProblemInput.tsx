'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Select, Textarea } from '@/components/ui/FormControls'
import { OJ_PLATFORMS_NO_ALL, getOjPlatformLabel, normalizeOjPlatformKey } from '@/lib/oj-platforms'
import { useAuth } from '@/features/auth'
import { resolveProblemSelection } from '../api/problemSelectionApi'
import { parseProblemCodes, prepareProblemSelection, problemSelectionInputError, type SelectedCanonicalProblem } from '../model/problemSelection'
import styles from './QuickProblemInput.module.css'

export interface QuickProblemInputProps {
  existingProblemIds?: Iterable<string>
  onResolved: (problems: SelectedCanonicalProblem[]) => void | Promise<void>
  autoFocus?: boolean
  disabled?: boolean
  label?: string
  /** Existing assessment callers stay strict until explicitly migrated. */
  requireStable?: boolean
}

type Preview = ReturnType<typeof prepareProblemSelection>

export function QuickProblemInput({ existingProblemIds, onResolved, autoFocus = true, disabled, label = '按题号添加', requireStable = true }: QuickProblemInputProps) {
  const { user, sessionKey } = useAuth()
  const storageKey = `problem-selection:last-platform:${user?.userId || 'anonymous'}`
  const [platform, setPlatform] = useState('carits')
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [requestError, setRequestError] = useState('')
  const requestRef = useRef(0)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(false)
  const contextRef = useRef(sessionKey)
  contextRef.current = sessionKey
  const existing = useMemo(() => new Set(existingProblemIds || []), [existingProblemIds])
  const existingRef = useRef(existing)
  existingRef.current = existing
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const codes = useMemo(() => parseProblemCodes(value), [value])
  const inputError = problemSelectionInputError(codes)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; requestRef.current++; inFlightRef.current = false }
  }, [])

  useEffect(() => {
    requestRef.current++
    inFlightRef.current = false
    setLoading(false)
    setValue('')
    setPreview(null)
    setRequestError('')
    let saved: string | null = null
    try { saved = normalizeOjPlatformKey(window.localStorage.getItem(storageKey) || '') } catch { /* Storage is optional. */ }
    setPlatform(saved && OJ_PLATFORMS_NO_ALL.some(item => item.value === saved) ? saved : 'carits')
  }, [storageKey, sessionKey])

  const changePlatform = (next: string) => {
    const canonical = normalizeOjPlatformKey(next)
    if (!canonical) return
    setPlatform(canonical)
    setPreview(null)
    setRequestError('')
    try { window.localStorage.setItem(storageKey, canonical) } catch { /* Do not break selection in restricted browsers. */ }
  }

  const submit = async () => {
    if (!codes.length || inputError || inFlightRef.current || disabled) return
    const requestId = ++requestRef.current
    const context = sessionKey
    const current = () => mountedRef.current && requestId === requestRef.current && contextRef.current === context
    inFlightRef.current = true
    setLoading(true)
    setRequestError('')
    setPreview(null)
    let phase: 'lookup' | 'handoff' = 'lookup'
    try {
      const response = await resolveProblemSelection({
        items: codes.map((problemCode, index) => ({ clientKey: `${requestId}-${index}`, platform, problemCode })),
      })
      if (!current()) return
      if (!response.ok) {
        setRequestError(`检索请求失败，输入已保留。${response.error.message}`)
        return
      }
      if (disabledRef.current) {
        setRequestError('当前表单已不可编辑，题目未选入；输入已保留。')
        return
      }
      const result = prepareProblemSelection(response.data.items, existingRef.current, requireStable)
      phase = 'handoff'
      if (result.accepted.length) await onResolved(result.accepted)
      if (!current()) return
      setPreview(result)
      // Preserve the original input: a legacy caller may accept only part of a batch.
      // Finding/handoff is not a persistence receipt, and must not erase retry input.
    } catch (error) {
      if (current()) setRequestError(`${phase === 'lookup' ? '检索请求失败' : '选入当前表单失败'}，输入已保留。${error instanceof Error ? error.message : '请重试'}`)
    } finally {
      if (current()) { inFlightRef.current = false; setLoading(false) }
    }
  }

  const example = platform === 'carits' ? '例如 10086' : platform === 'luogu' ? '例如 P1001' : platform === 'codeforces' ? '例如 2036G' : '输入当前平台的原始题号'
  return <section className={styles.root} aria-label={label} aria-busy={loading}>
    <div className={styles.fields}>
      <Select aria-label="题目平台" value={platform} onChange={event => changePlatform(event.target.value)} disabled={disabled || loading}>
        {OJ_PLATFORMS_NO_ALL.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </Select>
      <Textarea className={styles.input} rows={2} aria-label="题号" aria-invalid={Boolean(inputError)}
        placeholder={`${example}；支持空格、逗号或换行批量输入`} value={value} autoFocus={autoFocus} disabled={disabled || loading}
        onChange={event => { setValue(event.target.value); setPreview(null); setRequestError('') }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        }} />
      <Button type="button" onClick={() => void submit()} loading={loading} disabled={disabled || !codes.length || Boolean(inputError)}>添加</Button>
    </div>
    <p className={styles.hint}>只按平台和题号精确检索系统已有题目，不从外部拉取。题号区分大小写；Enter 添加，Shift+Enter 换行。</p>
    {inputError && <p className={styles.message} role="alert">{inputError}</p>}
    {requestError && <p className={styles.message} role="alert">{requestError}</p>}
    {preview && <>
      <p className={styles.summary} role="status">本次找到 {preview.rows.filter(row => Boolean(row.result.problem)).length} 道，已在列表 {preview.rows.filter(row => row.state === 'duplicate').length} 道，待处理 {preview.remainingCodes.length} 道。题目选入表单后仍需保存；原输入已保留。</p>
      <ul className={styles.results}>{preview.rows.map(({ result, state, message }) => <li className={styles.result} data-status={state === 'blocked' && result.status === 'resolved' ? 'stable_unavailable' : result.status} key={result.clientKey}>
        <strong>{getOjPlatformLabel(result.platform)} · {result.problemCode}{result.problem ? ` · ${result.problem.title}` : ''}</strong>
        <span className={styles.message}>{message}</span>
      </li>)}</ul>
    </>}
  </section>
}
