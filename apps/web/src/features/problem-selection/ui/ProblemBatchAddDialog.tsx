'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormDialog } from '@/components/ui/Dialogs'
import { Select, Textarea } from '@/components/ui/FormControls'
import { OJ_PLATFORMS_NO_ALL, getOjPlatformLabel } from '@/lib/oj-platforms'
import { useAuth } from '@/features/auth'
import { resolveProblemSelection } from '../api/problemSelectionApi'
import {
  parseProblemIds,
  prepareProblemSelection,
  problemSelectionInputError,
  type SelectedCanonicalProblem,
} from '../model/problemSelection'
import { ProblemReferenceResult } from './ProblemReferenceResult'
import styles from './ProblemReferenceSelector.module.css'

type Preview = ReturnType<typeof prepareProblemSelection>

export function ProblemBatchAddDialog({
  isOpen,
  onClose,
  platform,
  onPlatformChange,
  existingProblemIds,
  requireStable,
  onAdd,
}: {
  isOpen: boolean
  onClose: () => void
  platform: string
  onPlatformChange: (platform: string) => void
  existingProblemIds?: Iterable<string>
  requireStable: boolean
  onAdd: (problems: SelectedCanonicalProblem[]) => void | Promise<void>
}) {
  const { sessionKey } = useAuth()
  const [value, setValue] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [requestError, setRequestError] = useState('')
  const requestRef = useRef(0)
  const codes = useMemo(() => parseProblemIds(value), [value])
  const existing = useMemo(() => [...(existingProblemIds || [])], [existingProblemIds])
  const inputError = problemSelectionInputError(codes)

  useEffect(() => {
    requestRef.current++
    setPreview(null)
    setRequestError('')
    setLoading(false)
  }, [platform, sessionKey])

  useEffect(() => {
    if (!isOpen) {
      requestRef.current++
      setValue('')
      setPreview(null)
      setRequestError('')
      setLoading(false)
    }
  }, [isOpen])

  const lookup = async () => {
    if (!codes.length || inputError || loading) return
    const requestId = ++requestRef.current
    setLoading(true)
    setPreview(null)
    setRequestError('')
    try {
      const response = await resolveProblemSelection({
        items: codes.map((problemId, index) => ({ clientKey: `${requestId}-${index}`, platform, problemId })),
      })
      if (requestId !== requestRef.current) return
      if (!response.ok) {
        setRequestError(response.error.message)
        return
      }
      setPreview(prepareProblemSelection(response.data.items, existing, requireStable))
    } catch (error) {
      if (requestId === requestRef.current) setRequestError(error instanceof Error ? error.message : '批量检索失败，请重试')
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }

  const add = async () => {
    if (!preview?.accepted.length || loading) return
    setLoading(true)
    try {
      await onAdd(preview.accepted)
      if (preview.remainingProblemIds.length) {
        setValue(preview.remainingProblemIds.join('\n'))
        setPreview(null)
      } else {
        onClose()
      }
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '选入当前表单失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const footer = <>
    <Button variant="secondary" onClick={onClose} disabled={loading}>取消</Button>
    {preview
      ? <Button onClick={() => void add()} loading={loading} disabled={!preview.accepted.length}>加入 {preview.accepted.length} 道题</Button>
      : <Button onClick={() => void lookup()} loading={loading} disabled={!codes.length || Boolean(inputError)}>检索</Button>}
  </>

  return <FormDialog
    isOpen={isOpen}
    onClose={onClose}
    title="批量添加题目"
    description="选择一个平台后粘贴多个题号。只检索当前可访问题库，不从外部 OJ 拉取。"
    size="lg"
    loading={loading}
    dirty={Boolean(value)}
    footer={footer}
  >
    <div className={styles.batchBody}>
      <div className={styles.batchFields}>
        <Select aria-label="批量题目平台" value={platform} onChange={event => { onPlatformChange(event.target.value); setPreview(null) }} disabled={loading}>
          {OJ_PLATFORMS_NO_ALL.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </Select>
        <Textarea
          className={styles.batchInput}
          rows={7}
          aria-label="批量题号"
          value={value}
          disabled={loading}
          placeholder="每行一个题号，也支持空格、逗号或分号分隔"
          onChange={event => { setValue(event.target.value); setPreview(null); setRequestError('') }}
        />
      </div>
      {inputError && <p className={styles.batchSummary} role="alert">{inputError}</p>}
      {requestError && <p className={styles.batchSummary} role="alert">{requestError}</p>}
      {preview && <>
        <p className={styles.batchSummary}>平台：{getOjPlatformLabel(platform)}。找到 {preview.rows.filter(row => Boolean(row.result.problem)).length} 道，可加入 {preview.accepted.length} 道，待处理 {preview.remainingProblemIds.length} 道。</p>
        <ul className={styles.batchResults}>{preview.rows.map(row => <li className={styles.batchResult} key={row.result.clientKey}>
          <span className={styles.batchCode}>{row.result.problemId}</span>
          <ProblemReferenceResult row={row} />
        </li>)}</ul>
      </>}
    </div>
  </FormDialog>
}
