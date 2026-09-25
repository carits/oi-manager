'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import unifiedStyles from './TrainingStatementManagementPage.unified.module.css'
import { Button } from '@/components/ui/Button'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'

interface Option {
  key: string
  groupKey: string
  name: string
  authorUsername: string
  language: string | null
  format: string
  visibility: string
  unavailable: boolean
}
interface Problem {
  trainingProblemId: string
  alias: string | null
  orderIndex: number
  title: string
  selectionRevision: number
  options: Option[]
  selected: Array<{ key: string; isDefault: boolean; orderIndex: number }>
}
interface Payload { training: { id: number; title: string; type: string }; problems: Problem[] }

export function TrainingStatementManagementPage({ trainingId, backPath }: { trainingId: string; backPath?: string }) {
  const router = useRouter()
  const toast = useToast()
  const toastRef = useRef(toast)
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Record<string, { keys: string[]; defaultKey: string }>>({})

  useEffect(() => { toastRef.current = toast }, [toast])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const response = await apiClient.get<Payload>(`/api/contests/${trainingId}/statement-management`)
    if (!response.success || !response.data) {
      const message = response.message || '加载题面管理失败'
      if (response.status === 403 && backPath) {
        toastRef.current.error(message)
        router.replace(backPath)
      } else {
        setLoadError(message)
      }
    }
    else {
      setData(response.data)
      setSelection(Object.fromEntries(response.data.problems.map(problem => [problem.trainingProblemId, {
        keys: [...problem.selected].sort((a, b) => a.orderIndex - b.orderIndex).map(item => item.key),
        defaultKey: problem.selected.find(item => item.isDefault)?.key || problem.selected[0]?.key || '',
      }])))
    }
    setLoading(false)
  }, [backPath, router, trainingId])
  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => {
    if (!data) return []
    const map = new Map<string, { key: string; label: Option; cells: Record<string, Option> }>()
    for (const problem of data.problems) for (const option of problem.options) {
      const row = map.get(option.groupKey) || { key: option.groupKey, label: option, cells: {} }
      row.cells[problem.trainingProblemId] = option
      map.set(option.groupKey, row)
    }
    return Array.from(map.values()).sort((a, b) => {
      const rank = (option: Option) => option.groupKey.startsWith('canonical:') ? 0 : option.visibility === 'mine' ? 1 : option.visibility === 'frozen' ? 3 : 2
      return rank(a.label) - rank(b.label) || a.label.name.localeCompare(b.label.name, 'zh-CN')
    })
  }, [data])

  const toggle = (problemId: string, key: string) => setSelection(current => {
    const state = current[problemId]
    const included = state.keys.includes(key)
    if (included && state.defaultKey === key) return current
    const keys = included ? state.keys.filter(item => item !== key) : [...state.keys, key]
    return { ...current, [problemId]: { keys, defaultKey: state.defaultKey || key } }
  })
  const makeDefault = (problemId: string, key: string) => setSelection(current => {
    const state = current[problemId]
    return { ...current, [problemId]: { keys: state.keys.includes(key) ? state.keys : [...state.keys, key], defaultKey: key } }
  })

  const save = async () => {
    if (!data) return
    for (const problem of data.problems) {
      const state = selection[problem.trainingProblemId]
      if (!state?.keys.length || !state.keys.includes(state.defaultKey)) return toast.error(`${problem.alias || problem.orderIndex + 1} 题必须选择题面并指定默认版本`)
    }
    setSaving(true)
    const response = await apiClient.put(`/api/contests/${trainingId}/statement-management`, {
      selections: data.problems.map(problem => ({
        trainingProblemId: problem.trainingProblemId,
        visibleOptionKeys: selection[problem.trainingProblemId].keys,
        defaultOptionKey: selection[problem.trainingProblemId].defaultKey,
        expectedSelectionRevision: problem.selectionRevision,
      })),
    })
    if (response.success) { toast.success('活动题面配置已保存'); await load() }
    else toast.error(response.message || '保存失败')
    setSaving(false)
  }

  if (loading && !data) return <PageFrame><div className={unifiedStyles.u1}>正在加载题面矩阵…</div></PageFrame>
  if (!data) return <PageFrame><PageHeader title="题面选择无法加载" description={loadError || '活动题面数据暂时不可用'} actions={<Button variant="ghost" onClick={() => backPath ? router.replace(backPath) : router.back()}>返回活动</Button>} /></PageFrame>
  const matrixStyle = { '--statement-matrix-width': `${Math.max(900, 330 + data.problems.length * 150)}px` } as CSSProperties
  return (
    <PageFrame>
      <PageHeader title="题面选择" description={`${data.training.title} · 为参赛者选择可用题面并指定默认版本`} actions={<div className={unifiedStyles.u2}><Button variant="ghost" onClick={() => backPath ? router.replace(backPath) : router.back()}>返回活动</Button><Button variant="ghost" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存题面选择'}</Button></div>} />
      <div className={unifiedStyles.u3}>点击空白/✓切换是否提供；点击星标设为默认。每道题可有多个 ✓，但只能有一个 ★。</div>
      <div className={unifiedStyles.u4}>
        <TableRoot className={unifiedStyles.matrixTable} style={matrixStyle}>
          <TableHead><TableRow><TableHeaderCell className={unifiedStyles.u5}>可用题面</TableHeaderCell>{data.problems.map(problem => <TableHeaderCell key={problem.trainingProblemId} className={unifiedStyles.u6}>{problem.alias || String.fromCharCode(65 + problem.orderIndex)}</TableHeaderCell>)}</TableRow></TableHead>
          <TableBody>{rows.map(row => <TableRow key={row.key}>
            <TableCell className={unifiedStyles.u8}><strong>{row.label.name}</strong><div className={unifiedStyles.u9}>{row.label.authorUsername} · {row.label.visibility === 'mine' ? '我的' : row.label.visibility === 'frozen' ? '已固化' : row.key.startsWith('canonical:') ? '官方' : '公开'} · {row.label.language || '未知'} · {row.label.format.toUpperCase()}</div></TableCell>
            {data.problems.map(problem => {
              const option = row.cells[problem.trainingProblemId]
              if (!option) return <TableCell key={problem.trainingProblemId} className={unifiedStyles.u10}>—</TableCell>
              const state = selection[problem.trainingProblemId]
              const included = state?.keys.includes(option.key)
              const isDefault = state?.defaultKey === option.key
              return <TableCell key={problem.trainingProblemId} className={`${unifiedStyles.matrixCell} ${isDefault ? unifiedStyles.defaultCell : included ? unifiedStyles.includedCell : ''}`}>
                <Button variant="ghost" aria-label={`${problem.alias || problem.orderIndex + 1} ${row.label.name} ${included ? '取消提供' : '提供'}`} onClick={() => toggle(problem.trainingProblemId, option.key)} className={`${unifiedStyles.matrixToggle} ${included ? unifiedStyles.matrixToggleIncluded : ''}`} disabled={isDefault}>{isDefault ? '★' : included ? '✓' : ''}</Button>
                {!isDefault && <Button variant="ghost" aria-label={`设为 ${problem.alias || problem.orderIndex + 1} 默认题面`} onClick={() => makeDefault(problem.trainingProblemId, option.key)} className={unifiedStyles.u11}>☆</Button>}
              </TableCell>
            })}
          </TableRow>)}</TableBody>
        </TableRoot>
      </div>
    </PageFrame>
  )
}
