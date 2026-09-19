'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ResolvedProblemSelection } from '@oi-manager/contracts'
import { Button } from '@/components/ui/Button'
import { Select, Textarea } from '@/components/ui/FormControls'
import { OJ_PLATFORMS_NO_ALL } from '@/lib/oj-platforms'
import { useAuth } from '@/features/auth'
import { resolveProblemSelection } from '../api/problemSelectionApi'
import { parseProblemCodes, type SelectedCanonicalProblem } from '../model/problemSelection'
import styles from './QuickProblemInput.module.css'

export interface QuickProblemInputProps {
  existingProblemIds?: Iterable<string>
  onResolved: (problems: SelectedCanonicalProblem[]) => void | Promise<void>
  autoFocus?: boolean
  disabled?: boolean
  label?: string
}

const statusText: Record<ResolvedProblemSelection['status'], string> = {
  resolved: '已加入',
  not_found: '未找到',
  revision_unavailable: '无正式评测版本',
}

export function QuickProblemInput({ existingProblemIds, onResolved, autoFocus = true, disabled, label = '按题号添加' }: QuickProblemInputProps) {
  const { user } = useAuth()
  const storageKey = `problem-selection:last-platform:${user?.userId || 'anonymous'}`
  const [platform, setPlatform] = useState('carits')
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ResolvedProblemSelection[]>([])
  const requestRef = useRef(0)
  const existing = useMemo(() => new Set(existingProblemIds || []), [existingProblemIds])

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey)
    if (saved && OJ_PLATFORMS_NO_ALL.some(item => item.value === saved)) setPlatform(saved)
  }, [storageKey])

  const changePlatform = (next: string) => {
    setPlatform(next)
    window.localStorage.setItem(storageKey, next)
  }

  const submit = async () => {
    const codes = parseProblemCodes(value)
    if (!codes.length || loading || disabled) return
    const requestId = ++requestRef.current
    setLoading(true)
    const response = await resolveProblemSelection({
      items: codes.map((problemCode, index) => ({ clientKey: `${requestId}-${index}`, platform, problemCode })),
    })
    if (requestId !== requestRef.current) return
    setLoading(false)
    if (!response.ok) {
      setResults(codes.map((problemCode, index) => ({ clientKey: `${requestId}-${index}`, platform, problemCode, status: 'not_found', message: response.error.message })))
      return
    }
    const seen = new Set(existing)
    const accepted: SelectedCanonicalProblem[] = []
    const displayed = response.data.items.map(item => {
      if (item.status !== 'resolved' || !item.problem) return item
      if (seen.has(item.problem.id)) return { ...item, message: '该题已添加' }
      seen.add(item.problem.id)
      accepted.push(item.problem)
      return item
    })
    setResults(displayed)
    await onResolved(accepted)
    const failed = response.data.items.filter(item => item.status !== 'resolved').map(item => item.problemCode)
    setValue(failed.join('\n'))
  }

  const duplicateCount = results.filter(item => item.status === 'resolved' && item.message === '该题已添加').length
  const acceptedCount = results.filter(item => item.status === 'resolved').length - duplicateCount
  const failedCount = results.length - results.filter(item => item.status === 'resolved').length

  return <section className={styles.root} aria-label={label}>
    <div className={styles.fields}>
      <Select aria-label="题目平台" value={platform} onChange={event => changePlatform(event.target.value)} disabled={disabled || loading}>
        {OJ_PLATFORMS_NO_ALL.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </Select>
      <Textarea
        className={styles.input}
        rows={2}
        aria-label="题号"
        placeholder="输入题号，例如 P1001；支持空格、逗号或换行批量粘贴"
        value={value}
        autoFocus={autoFocus}
        disabled={disabled || loading}
        onChange={event => setValue(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void submit()
          }
        }}
      />
      <Button type="button" onClick={() => void submit()} loading={loading} disabled={disabled || !parseProblemCodes(value).length}>添加</Button>
    </div>
    <p className={styles.hint}>Enter 添加，Shift+Enter 换行；只会解析题库中已存在且当前账号可使用的题目。</p>
    {results.length > 0 && <>
      <p className={styles.summary} role="status">本次：添加 {acceptedCount} 道，已存在 {duplicateCount} 道，待处理 {failedCount} 道。</p>
      <ul className={styles.results}>
        {results.map(item => <li className={styles.result} data-status={item.status} key={item.clientKey}>
          <strong>{item.platform} · {item.problemCode}{item.problem ? ` · ${item.problem.title}` : ''}</strong>
          <span className={styles.message}>{item.message || statusText[item.status]}</span>
        </li>)}
      </ul>
    </>}
  </section>
}
