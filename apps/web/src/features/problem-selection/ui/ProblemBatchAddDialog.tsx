'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, FormDialog } from '@/components/ui/Dialogs'
import { Textarea } from '@/components/ui/FormControls'
import { parseProblemReferenceImport } from '../model/problemReferenceImport'
import {
  prepareProblemSelection,
  type ProblemDataRequirement,
  type ProblemReferenceAddReceipt,
  type SelectedProblemReference,
} from '../model/problemSelection'
import { useProblemReferenceResolver } from '../model/useProblemReferenceResolver'
import { ProblemReferenceResult } from './ProblemReferenceResult'
import styles from './ProblemReferenceSelector.module.css'

export function ProblemBatchAddDialog({
  onClose, existingProblemIds, dataRequirement, onAdd, contextKey, disabled, adding,
}: {
  onClose: () => void
  existingProblemIds: readonly string[]
  dataRequirement: ProblemDataRequirement
  onAdd: (references: SelectedProblemReference[]) => Promise<ProblemReferenceAddReceipt | undefined>
  contextKey: string
  disabled: boolean
  adding: boolean
}) {
  const [value, setValue] = useState('')
  const [confirmedIds, setConfirmedIds] = useState<string[]>([])
  const [addError, setAddError] = useState('')
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [confirmClose, setConfirmClose] = useState(false)
  const mounted = useRef(false)
  const addLock = useRef(false)

  const parsed = useMemo(() => parseProblemReferenceImport(value), [value])
  const requestItems = useMemo(() => parsed.validRows.map(row => ({
    clientKey: row.clientKey,
    platform: row.platform!,
    problemId: row.problemId,
  })), [parsed.validRows])
  const inputKey = JSON.stringify([contextKey, value, disabled, dataRequirement])
  const latestKey = useRef(inputKey)
  latestKey.current = inputKey

  const resolution = useProblemReferenceResolver({
    items: requestItems,
    enabled: !disabled && !parsed.error && requestItems.length > 0,
    contextKey: JSON.stringify([contextKey, value]),
    automatic: false,
  })
  const preview = prepareProblemSelection(resolution.items, [...existingProblemIds, ...confirmedIds], dataRequirement)
  const previewByKey = new Map(preview.rows.map(row => [row.result.clientKey, row]))
  const sourceByKey = new Map(parsed.rows.map(row => [row.clientKey, row]))
  const readyReferences: SelectedProblemReference[] = preview.rows.flatMap(row => {
    if (row.state !== 'ready' || !row.result.problem) return []
    const source = sourceByKey.get(row.result.clientKey)
    return [{ problem: row.result.problem, alias: source?.alias || undefined, lineNumber: source?.lineNumber }]
  })
  const invalidCount = parsed.rows.filter(row => row.error).length
  const duplicateCount = preview.rows.filter(row => row.state === 'duplicate').length

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const edit = (next: string) => {
    setValue(next)
    setConfirmedIds([])
    setAddError('')
    setRowErrors({})
  }

  const requestClose = () => {
    if (adding || addLock.current) return
    if (value.trim()) setConfirmClose(true)
    else onClose()
  }

  const add = async () => {
    if (!readyReferences.length || disabled || adding || addLock.current) return
    addLock.current = true
    const key = inputKey
    const current = () => mounted.current && latestKey.current === key
    setAddError('')
    setRowErrors({})
    try {
      const receipt = await onAdd(readyReferences)
      if (!receipt || !current()) return
      const accepted = new Set([...confirmedIds, ...receipt.acceptedIds])
      setConfirmedIds([...accepted])
      setRowErrors(Object.fromEntries((receipt.rejected || []).map(item => [item.id, item.message])))
      const remaining = prepareProblemSelection(resolution.items, [...existingProblemIds, ...accepted], dataRequirement)
      if (!remaining.accepted.length && !remaining.remainingProblemIds.length && invalidCount === 0 && !(receipt.rejected?.length)) onClose()
      else if (receipt.rejected?.length) setAddError('部分题目未选入，成功项已保留；可重试剩余题目。')
    } catch (error) {
      if (current()) setAddError(error instanceof Error ? error.message : '选入失败，输入已保留，请重试')
    } finally {
      addLock.current = false
    }
  }

  if (typeof document === 'undefined') return null
  return createPortal(<>
    <FormDialog
      isOpen
      onClose={requestClose}
      title="批量添加题目"
      description="每行一题：平台 | 题号 | 别名。别名可省略；每次最多 100 道。检索只查询系统已有题目。"
      size="lg"
      loading={adding}
      footer={<>
        <Button type="button" variant="secondary" onClick={requestClose} disabled={adding}>取消</Button>
        <Button type="button" onClick={() => void add()} loading={adding} disabled={disabled || resolution.resolving || !readyReferences.length}>加入 {readyReferences.length} 道题</Button>
      </>}
    >
      <div className={styles.batchBody}>
        <label className={styles.field}>题目引用
          <Textarea
            className={styles.batchInput}
            rows={10}
            aria-label="批量题目引用"
            value={value}
            disabled={disabled || adding}
            aria-invalid={Boolean(parsed.error || invalidCount)}
            placeholder={'CodeForces | 242E | A\n洛谷 | P2023 | B\nLibreOJ | 2570 | AF'}
            onChange={event => edit(event.target.value)}
          />
        </label>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={() => void resolution.resolve()} loading={resolution.resolving} disabled={disabled || adding || !requestItems.length || Boolean(parsed.error)}>检索</Button>
          <span className={styles.hint}>{parsed.rows.length} 行 · {requestItems.length} 行可检索</span>
        </div>
        {(parsed.error || resolution.error || addError) && <p className={styles.error} role="alert">{parsed.error || resolution.error || addError}</p>}
        {resolution.resolving && <p className={styles.hint} role="status">正在检索…</p>}
        {parsed.rows.length > 0 && <>
          <p className={styles.batchSummary} role="status">
            可加入 {readyReferences.length} 道，已在当前列表或本次输入重复 {duplicateCount} 道，格式错误 {invalidCount} 道，待处理 {preview.remainingProblemIds.length} 道。选入后仍需保存业务表单。
          </p>
          <ul className={styles.batchResults}>{parsed.rows.map(source => {
            const row = previewByKey.get(source.clientKey)
            return <li className={styles.batchResult} key={source.clientKey}>
              <span className={styles.batchCode}>
                <strong>第 {source.lineNumber} 行</strong>
                <span>{source.platformInput || '—'} · {source.problemId || '—'}{source.alias ? ` · ${source.alias}` : ''}</span>
              </span>
              <div>
                {source.error
                  ? <p className={styles.error}>{source.error}</p>
                  : row
                    ? <ProblemReferenceResult row={row} />
                    : <span className={styles.resultIdle}>等待检索</span>}
                {row?.result.problem && rowErrors[row.result.problem.id] && <p className={styles.error}>{rowErrors[row.result.problem.id]}</p>}
              </div>
            </li>
          })}</ul>
        </>}
      </div>
    </FormDialog>
    <ConfirmDialog
      isOpen={confirmClose}
      onClose={() => setConfirmClose(false)}
      onConfirm={onClose}
      title="放弃剩余题目？"
      message="关闭后，未选入的题目引用将被丢弃；已经选入当前表单的题目不会删除。"
      confirmText="放弃并关闭"
      danger
    />
  </>, document.body)
}
