'use client'

import type { ResolvedProblemSelection } from '@oi-manager/contracts'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { useAuth } from '@/features/auth'
import { OJ_PLATFORMS_NO_ALL, normalizeOjPlatformKey } from '@/lib/oj-platforms'
import { resolveProblemSelection } from '../api/problemSelectionApi'
import { parseProblemReferenceImport } from '../model/problemReferenceImport'
import {
  orderProblemSelectionResults,
  prepareProblemSelection,
  problemReferenceAddReceipt,
  ProblemReferenceOperation,
  type AddProblemReferences,
  type ProblemDataRequirement,
  type SelectedCanonicalProblem,
  type SelectedProblemReference,
} from '../model/problemSelection'
import { ProblemReferenceLink } from './ProblemReferenceLink'
import styles from './ProblemListEditor.module.css'

type RowStatus = 'editing' | 'resolving' | 'ready' | 'not_found' | 'unavailable' | 'conflict' | 'error'

interface DraftRow {
  clientKey: string
  platform: string
  problemId: string
  alias: string
  status: RowStatus
  problem?: SelectedCanonicalProblem
  message?: string
}

export interface ProblemListEditorProps {
  references: readonly SelectedProblemReference[]
  onReplace: AddProblemReferences
  contextKey?: string
  disabled?: boolean
  dataRequirement?: ProblemDataRequirement
  aliasLabel?: string | null
  onBlockingChange?: (blocked: boolean) => void
  renderTrailing?: (reference: SelectedProblemReference, index: number) => ReactNode
  emptyText?: string
}

let rowCounter = 0
const nextClientKey = () => `problem-row-${++rowCounter}`

const referenceSignature = (references: readonly SelectedProblemReference[]) => JSON.stringify(
  references.map(reference => [
    reference.problem.id,
    reference.problem.platform,
    reference.problem.problemId,
    reference.alias || '',
  ]),
)

function rowsFromReferences(references: readonly SelectedProblemReference[]): DraftRow[] {
  return references.map(reference => ({
    clientKey: nextClientKey(),
    platform: reference.problem.platform,
    problemId: reference.problem.problemId,
    alias: reference.alias || '',
    status: 'ready',
    problem: reference.problem,
  }))
}

function readyReferences(rows: readonly DraftRow[]): SelectedProblemReference[] {
  return rows.flatMap(row => row.status === 'ready' && row.problem
    ? [{ problem: row.problem, alias: row.alias.trim() || undefined }]
    : [])
}

function rowMessage(status: RowStatus, fallback?: string) {
  if (fallback) return fallback
  if (status === 'not_found') return '未找到该题'
  if (status === 'unavailable') return '该题暂不可用'
  if (status === 'conflict') return '平台和题号存在重复记录'
  if (status === 'error') return '暂时无法确认'
  return ''
}

export function ProblemListEditor({
  references,
  onReplace,
  contextKey,
  disabled = false,
  dataRequirement = 'stable',
  aliasLabel = '别名',
  onBlockingChange,
  renderTrailing,
  emptyText = '还没有题目',
}: ProblemListEditorProps) {
  const { user, sessionKey } = useAuth()
  const pathname = usePathname()
  const scope = JSON.stringify([sessionKey, pathname, contextKey])
  const storageKey = `problem-list-editor:last-platform:${user?.userId || 'anonymous'}`
  const externalSignature = useMemo(() => referenceSignature(references), [references])
  const [rows, setRows] = useState<DraftRow[]>(() => rowsFromReferences(references))
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const [textMode, setTextMode] = useState(false)
  const [textValue, setTextValue] = useState('')
  const [textBusy, setTextBusy] = useState(false)
  const [textError, setTextError] = useState('')
  const [businessError, setBusinessError] = useState('')
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const inputRefs = useRef(new Map<string, HTMLInputElement>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const controllers = useRef(new Map<string, AbortController>())
  const businessOperation = useRef(new ProblemReferenceOperation())
  const composing = useRef(new Set<string>())
  const dragging = useRef<number | null>(null)
  const lastPlatform = useRef('carits')

  useEffect(() => {
    try {
      const saved = normalizeOjPlatformKey(window.localStorage.getItem(storageKey) || '')
      if (saved && OJ_PLATFORMS_NO_ALL.some(item => item.value === saved)) lastPlatform.current = saved
    } catch { /* optional */ }
  }, [storageKey])

  useEffect(() => {
    return () => {
      timers.current.forEach(timer => clearTimeout(timer))
      controllers.current.forEach(controller => controller.abort())
      businessOperation.current.cancel()
    }
  }, [])

  useEffect(() => {
    if (!focusKey) return
    inputRefs.current.get(focusKey)?.focus()
    setFocusKey(null)
  }, [focusKey, rows])

  const projectedSignature = referenceSignature(readyReferences(rows))
  useEffect(() => {
    if (externalSignature === projectedSignature) return
    setRows(rowsFromReferences(references))
    setBusinessError('')
  // Only external changes should synchronize the editor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSignature, scope])

  useEffect(() => {
    onBlockingChange?.(rows.some(row => row.status !== 'ready'))
  }, [onBlockingChange, rows])

  const clearRowWork = (clientKey: string) => {
    const timer = timers.current.get(clientKey)
    if (timer) clearTimeout(timer)
    timers.current.delete(clientKey)
    controllers.current.get(clientKey)?.abort()
    controllers.current.delete(clientKey)
  }

  const commitProjection = async (nextRows: DraftRow[]) => {
    if (disabled || !sessionKey) return
    const refs = readyReferences(nextRows)
    const ticket = businessOperation.current.begin('replace')
    setBusinessError('')
    try {
      const receipt = problemReferenceAddReceipt(
        refs,
        await onReplace(refs, { signal: ticket.signal, isCurrent: ticket.isCurrent }),
      )
      if (!ticket.isCurrent()) return
      if (receipt.rejected?.length) {
        const rejected = new Map(receipt.rejected.map(item => [item.id, item.message]))
        setRows(current => current.map(row => row.problem && rejected.has(row.problem.id)
          ? { ...row, status: 'error', message: rejected.get(row.problem.id) }
          : row))
      }
    } catch (error) {
      if (ticket.isCurrent()) setBusinessError(error instanceof Error ? error.message : '题目列表更新失败')
    } finally {
      businessOperation.current.finish(ticket)
    }
  }

  const assessResolved = (
    result: ResolvedProblemSelection,
    currentRows: readonly DraftRow[],
    clientKey: string,
  ): Pick<DraftRow, 'status' | 'problem' | 'message'> => {
    if (result.status !== 'resolved' || !result.problem) {
      const status: RowStatus = result.status === 'not_found' ? 'not_found'
        : result.status === 'identity_conflict' ? 'conflict'
          : result.status === 'not_published' ? 'unavailable'
            : 'error'
      return { status, message: rowMessage(status, result.message) }
    }
    const duplicate = currentRows.some(row => row.clientKey !== clientKey && row.status === 'ready' && row.problem?.id === result.problem.id)
    if (duplicate) return { status: 'conflict', message: '该题已在当前列表中' }
    const assessment = prepareProblemSelection([result], [], dataRequirement)
    const assessed = assessment.rows[0]
    if (assessed.state !== 'ready') return { status: 'unavailable', message: assessed.message }
    return { status: 'ready', problem: result.problem, message: '' }
  }

  const resolveRow = async (clientKey: string, appendNext = false) => {
    const row = rowsRef.current.find(item => item.clientKey === clientKey)
    if (!row || disabled || !sessionKey) return false
    const platform = normalizeOjPlatformKey(row.platform)
    const problemId = row.problemId.trim()
    if (!platform || !problemId) return false
    if (problemId.length > 128 || /[\s,;，；]/u.test(problemId) || /:\/\//u.test(problemId)) {
      const next = rowsRef.current.map(item => item.clientKey === clientKey
        ? { ...item, status: 'error' as const, problem: undefined, message: problemId.length > 128 ? '题号不能超过 128 个字符' : '请只填写原始题号' }
        : item)
      setRows(next)
      await commitProjection(next)
      return false
    }

    clearRowWork(clientKey)
    const controller = new AbortController()
    controllers.current.set(clientKey, controller)
    setRows(current => current.map(item => item.clientKey === clientKey ? { ...item, status: 'resolving', problem: undefined, message: '' } : item))
    try {
      const response = await resolveProblemSelection({
        items: [{ clientKey, platform, problemId }],
      }, { signal: controller.signal })
      if (!response.ok) throw response.error
      const result = orderProblemSelectionResults([{ clientKey, platform, problemId }], response.data.items)[0]
      const currentRows = rowsRef.current
      const current = currentRows.find(item => item.clientKey === clientKey)
      if (!current || normalizeOjPlatformKey(current.platform) !== platform || current.problemId.trim() !== problemId) return false
      const assessed = assessResolved(result, currentRows, clientKey)
      let next = currentRows.map(item => item.clientKey === clientKey ? { ...item, platform, ...assessed } : item)
      if (assessed.status === 'ready' && appendNext) {
        const blank: DraftRow = { clientKey: nextClientKey(), platform: lastPlatform.current, problemId: '', alias: '', status: 'editing' }
        next = [...next, blank]
        setFocusKey(blank.clientKey)
      }
      setRows(next)
      await commitProjection(next)
      return assessed.status === 'ready'
    } catch (error) {
      if (controller.signal.aborted) return false
      const currentRows = rowsRef.current
      const next = currentRows.map(item => item.clientKey === clientKey
        ? { ...item, status: 'error' as const, problem: undefined, message: error instanceof Error ? error.message : '暂时无法确认' }
        : item)
      setRows(next)
      await commitProjection(next)
      return false
    } finally {
      if (controllers.current.get(clientKey) === controller) controllers.current.delete(clientKey)
    }
  }

  const scheduleResolve = (clientKey: string) => {
    clearRowWork(clientKey)
    const row = rowsRef.current.find(item => item.clientKey === clientKey)
    if (!row?.problemId.trim()) return
    timers.current.set(clientKey, setTimeout(() => {
      timers.current.delete(clientKey)
      void resolveRow(clientKey)
    }, 350))
  }

  const addRow = () => {
    if (disabled || textMode) return
    const row: DraftRow = {
      clientKey: nextClientKey(),
      platform: lastPlatform.current,
      problemId: '',
      alias: '',
      status: 'editing',
    }
    setRows(current => [...current, row])
    setFocusKey(row.clientKey)
  }

  const updateIdentity = (clientKey: string, updates: Partial<Pick<DraftRow, 'platform' | 'problemId'>>) => {
    setRows(current => current.map(row => row.clientKey === clientKey
      ? { ...row, ...updates, status: 'editing', problem: undefined, message: '' }
      : row))
    if (updates.platform) {
      const canonical = normalizeOjPlatformKey(updates.platform)
      if (canonical) {
        lastPlatform.current = canonical
        try { window.localStorage.setItem(storageKey, canonical) } catch { /* optional */ }
      }
    }
    if (!composing.current.has(clientKey)) queueMicrotask(() => scheduleResolve(clientKey))
  }

  const updateAlias = (clientKey: string, alias: string) => {
    setRows(current => current.map(row => row.clientKey === clientKey ? { ...row, alias } : row))
  }

  const commitAlias = (addNext = false) => {
    void commitProjection(rowsRef.current)
    if (addNext) addRow()
  }

  const removeRow = (clientKey: string) => {
    clearRowWork(clientKey)
    const next = rowsRef.current.filter(row => row.clientKey !== clientKey)
    setRows(next)
    void commitProjection(next)
  }

  const dropRow = (targetIndex: number) => {
    const sourceIndex = dragging.current
    dragging.current = null
    if (sourceIndex === null || sourceIndex === targetIndex || sourceIndex < 0 || sourceIndex >= rowsRef.current.length) return
    const next = [...rowsRef.current]
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    setRows(next)
    void commitProjection(next)
  }

  const beginTextEdit = () => {
    setTextValue(rowsRef.current.filter(row => row.problemId.trim()).map(row =>
      [row.platform, row.problemId, row.alias].filter((_, index) => index < 2 || row.alias.trim()).join(' | ')
    ).join('\n'))
    setTextError('')
    setTextMode(true)
  }

  const applyTextEdit = async () => {
    if (disabled || textBusy) return
    const parsed = parseProblemReferenceImport(textValue)
    if (parsed.error) { setTextError(parsed.error); return }
    const invalid = parsed.rows.find(row => row.error)
    if (invalid) { setTextError(`第 ${invalid.lineNumber} 行：${invalid.error}`); return }

    const nextRows: DraftRow[] = parsed.validRows.map(row => ({
      clientKey: row.clientKey,
      platform: row.platform!,
      problemId: row.problemId,
      alias: row.alias || '',
      status: 'resolving',
    }))
    setRows(nextRows)
    setTextMode(false)
    setTextBusy(true)
    setTextError('')
    if (!nextRows.length) {
      await commitProjection([])
      setTextBusy(false)
      return
    }

    try {
      const items = nextRows.map(row => ({ clientKey: row.clientKey, platform: row.platform, problemId: row.problemId }))
      const response = await resolveProblemSelection({ items })
      if (!response.ok) throw response.error
      const ordered = orderProblemSelectionResults(items, response.data.items)
      const seen = new Set<string>()
      const resolvedRows = nextRows.map((row, index) => {
        const result = ordered[index]
        const assessed = assessResolved(result, [], row.clientKey)
        if (assessed.status === 'ready' && assessed.problem) {
          if (seen.has(assessed.problem.id)) return { ...row, status: 'conflict' as const, message: '该题在列表中重复' }
          seen.add(assessed.problem.id)
        }
        return { ...row, ...assessed }
      })
      setRows(resolvedRows)
      await commitProjection(resolvedRows)
    } catch (error) {
      setRows(current => current.map(row => ({ ...row, status: 'error', message: error instanceof Error ? error.message : '暂时无法确认' })))
    } finally {
      setTextBusy(false)
    }
  }

  return <section className={styles.root} data-testid="problem-list-editor">
    <div className={styles.toolbar}>
      <div className={styles.toolbarActions}>
        <Button type="button" variant="secondary" size="sm" disabled={disabled || textMode} onClick={addRow}>＋ 添加一道题目</Button>
        <Button type="button" variant="ghost" size="sm" disabled={disabled || textMode} onClick={beginTextEdit}>编辑</Button>
      </div>
      <span className={styles.count}>{rows.length} 道</span>
    </div>

    {textMode ? <div className={styles.textMode}>
      <Textarea
        aria-label="题目列表文本编辑"
        rows={Math.max(8, Math.min(20, (textValue.match(/\n/g)?.length || 0) + 3))}
        value={textValue}
        disabled={disabled || textBusy}
        placeholder={'QOJ | 9422 | A\nQOJ | 9423 | B\n洛谷 | P1177 | C'}
        onChange={event => { setTextValue(event.target.value); setTextError('') }}
      />
      <div className={styles.textHint}>每行：平台 | 题号 | 别名（可选）</div>
      {textError && <p className={styles.error} role="alert">{textError}</p>}
      <div className={styles.textActions}>
        <Button type="button" variant="secondary" onClick={() => setTextMode(false)} disabled={textBusy}>取消</Button>
        <Button type="button" onClick={() => void applyTextEdit()} loading={textBusy} disabled={disabled || textBusy}>确认</Button>
      </div>
    </div> : <div className={styles.list}>
      {rows.length === 0 && <div className={styles.empty}>{emptyText}</div>}
      {rows.map((row, index) => {
        const editable = row.status !== 'ready'
        const reference = row.status === 'ready' && row.problem ? { problem: row.problem, alias: row.alias || undefined } : null
        return <div
          key={row.clientKey}
          className={`${styles.row} ${row.status === 'ready' ? styles.readyRow : styles.editingRow}`}
          draggable={!disabled && row.status === 'ready'}
          onDragStart={() => { dragging.current = index }}
          onDragOver={event => { if (!disabled) event.preventDefault() }}
          onDrop={() => dropRow(index)}
        >
          <span className={styles.handle} title="拖动调整顺序">{row.status === 'ready' ? '⋮⋮' : '+'}</span>
          <span className={styles.order}>{index + 1}</span>
          {editable ? <>
            <Select aria-label={`第 ${index + 1} 题平台`} value={row.platform} disabled={disabled} onChange={event => updateIdentity(row.clientKey, { platform: event.target.value })}>
              {OJ_PLATFORMS_NO_ALL.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
            <Input
              ref={element => { if (element) inputRefs.current.set(row.clientKey, element); else inputRefs.current.delete(row.clientKey) }}
              aria-label={`第 ${index + 1} 题题号`}
              value={row.problemId}
              disabled={disabled}
              placeholder="题号"
              autoComplete="off"
              spellCheck={false}
              onChange={event => updateIdentity(row.clientKey, { problemId: event.target.value })}
              onCompositionStart={() => { composing.current.add(row.clientKey); clearRowWork(row.clientKey) }}
              onCompositionEnd={() => { composing.current.delete(row.clientKey); scheduleResolve(row.clientKey) }}
              onKeyDown={event => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                if (!event.nativeEvent.isComposing && !composing.current.has(row.clientKey)) void resolveRow(row.clientKey, true)
              }}
            />
            {aliasLabel && <Input aria-label={`第 ${index + 1} 题${aliasLabel}`} value={row.alias} maxLength={50} disabled={disabled} placeholder={aliasLabel} onChange={event => updateAlias(row.clientKey, event.target.value)} onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              if (!event.nativeEvent.isComposing) void resolveRow(row.clientKey, true)
            }} />}
            <span className={`${styles.state} ${row.status === 'resolving' ? styles.pending : styles.problemState}`}>
              {row.status === 'resolving' ? '·' : row.message || ''}
            </span>
          </> : <>
            {aliasLabel && <Input
              className={styles.aliasInput}
              aria-label={`第 ${index + 1} 题${aliasLabel}`}
              value={row.alias}
              maxLength={50}
              disabled={disabled}
              placeholder={aliasLabel}
              onChange={event => updateAlias(row.clientKey, event.target.value)}
              onBlur={() => commitAlias()}
              onKeyDown={event => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                commitAlias(true)
              }}
            />}
            <span className={styles.identity}>{row.platform} · {row.problemId}</span>
            <span className={styles.title}><span className={styles.ok}>✓</span><ProblemReferenceLink problem={row.problem!} showIdentity={false} /></span>
            {reference && renderTrailing?.(reference, index)}
          </>}
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => removeRow(row.clientKey)} aria-label={`移除第 ${index + 1} 题`}>×</Button>
        </div>
      })}
    </div>}
    {businessError && <p className={styles.error} role="alert">{businessError}</p>}
  </section>
}
