'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, FormDialog } from '@/components/ui/Dialogs'
import { Select, Textarea } from '@/components/ui/FormControls'
import { OJ_PLATFORMS_NO_ALL } from '@/lib/oj-platforms'
import { parseProblemIds, prepareProblemSelection, problemSelectionInputError, type ProblemReferenceAddReceipt, type SelectedCanonicalProblem } from '../model/problemSelection'
import { useProblemReferenceResolver } from '../model/useProblemReferenceResolver'
import { ProblemReferenceResult } from './ProblemReferenceResult'
import styles from './ProblemReferenceSelector.module.css'

export function ProblemBatchAddDialog({
  onClose, platform, onPlatformChange, existingProblemIds, requireStable, onAdd, contextKey, disabled, adding,
}: {
  onClose: () => void
  platform: string
  onPlatformChange: (platform: string) => void
  existingProblemIds: readonly string[]
  requireStable: boolean
  onAdd: (problems: SelectedCanonicalProblem[]) => Promise<ProblemReferenceAddReceipt | undefined>
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
  const inputKey = JSON.stringify([contextKey, platform, value, disabled])
  const latestKey = useRef(inputKey)
  latestKey.current = inputKey
  const problemIds = useMemo(() => parseProblemIds(value), [value])
  const inputError = problemSelectionInputError(problemIds)
  const resolution = useProblemReferenceResolver({
    items: problemIds.map((problemId, index) => ({ clientKey: String(index), platform, problemId })),
    enabled: !disabled && !inputError,
    contextKey: JSON.stringify([contextKey, value]),
    automatic: false,
  })
  const preview = prepareProblemSelection(resolution.items, [...existingProblemIds, ...confirmedIds], requireStable)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const edit = (next: string) => { setValue(next); setConfirmedIds([]); setAddError(''); setRowErrors({}) }
  const requestClose = () => {
    if (adding || addLock.current) return
    if (value.trim()) setConfirmClose(true)
    else onClose()
  }

  const add = async () => {
    if (!preview.accepted.length || disabled || adding || addLock.current) return
    addLock.current = true
    const key = inputKey
    const current = () => mounted.current && latestKey.current === key
    setAddError('')
    setRowErrors({})
    try {
      const receipt = await onAdd(preview.accepted)
      if (!receipt || !current()) return
      const accepted = new Set([...confirmedIds, ...receipt.acceptedIds])
      setConfirmedIds([...accepted])
      setRowErrors(Object.fromEntries((receipt.rejected || []).map(item => [item.id, item.message])))
      const remaining = prepareProblemSelection(resolution.items, [...existingProblemIds, ...accepted], requireStable)
      if (!remaining.accepted.length && !remaining.remainingProblemIds.length) onClose()
      else if (receipt.rejected?.length) setAddError('部分题目未选入，成功项已保留；可重试剩余题目。')
    } catch (error) {
      if (current()) setAddError(error instanceof Error ? error.message : '选入失败，题号已保留，请重试')
    } finally {
      addLock.current = false
    }
  }

  // No nested form: this selector also lives inside Contest/Training form dialogs.
  return <>
    <FormDialog isOpen onClose={requestClose} title="批量添加题目" description="选择平台后粘贴题号，先检索，再选入当前表单。每次最多 100 道。" size="lg" loading={adding}
      footer={<><Button type="button" variant="secondary" onClick={requestClose} disabled={adding}>取消</Button><Button type="button" onClick={() => void add()} loading={adding} disabled={disabled || resolution.resolving || !preview.accepted.length}>加入 {preview.accepted.length} 道题</Button></>}
    >
      <div className={styles.batchBody}>
        <div className={styles.batchFields}>
          <label className={styles.field}>平台<Select aria-label="批量题目平台" value={platform} disabled={disabled || adding} onChange={event => { onPlatformChange(event.target.value); setConfirmedIds([]); setAddError(''); setRowErrors({}) }}>
            {OJ_PLATFORMS_NO_ALL.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </Select></label>
          <label className={styles.field}>题号<Textarea className={styles.batchInput} rows={7} aria-label="批量题号" value={value} disabled={disabled || adding} aria-invalid={Boolean(inputError)} placeholder="每行一个题号，也支持空格、逗号或分号分隔" onChange={event => edit(event.target.value)} /></label>
        </div>
        <div className={styles.actions}><Button type="button" variant="secondary" onClick={() => void resolution.resolve()} loading={resolution.resolving} disabled={disabled || adding || !problemIds.length || Boolean(inputError)}>检索</Button><span className={styles.hint}>{problemIds.length} 个不同题号</span></div>
        {(inputError || resolution.error || addError) && <p className={styles.error} role="alert">{inputError || resolution.error || addError}</p>}
        {resolution.resolving && <p className={styles.hint} role="status">正在检索…</p>}
        {preview.rows.length > 0 && <>
          <p className={styles.batchSummary} role="status">可加入 {preview.accepted.length} 道，已在列表 {preview.rows.filter(row => row.state === 'duplicate').length} 道，待处理 {preview.remainingProblemIds.length} 道。选入后仍需保存业务表单。</p>
          <ul className={styles.batchResults}>{preview.rows.map(row => <li className={styles.batchResult} key={row.result.clientKey}>
            <span className={styles.batchCode}>{row.result.problemId}</span>
            <div><ProblemReferenceResult row={row} />{row.result.problem && rowErrors[row.result.problem.id] && <p className={styles.error}>{rowErrors[row.result.problem.id]}</p>}</div>
          </li>)}</ul>
        </>}
      </div>
    </FormDialog>
    <ConfirmDialog isOpen={confirmClose} onClose={() => setConfirmClose(false)} onConfirm={onClose} title="放弃剩余题号？" message="关闭后，未选入的题号将被丢弃；已经选入当前表单的题目不会删除。" confirmText="放弃并关闭" danger />
  </>
}
