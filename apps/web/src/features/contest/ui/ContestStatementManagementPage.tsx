'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import unifiedStyles from './ContestStatementManagementPage.unified.module.css'
import { Button } from '@/components/ui/Button'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { useRouter } from 'next/navigation'
import type { ContestStatementManagement } from '@oi-manager/contracts'
import { getContestStatementManagement, saveContestStatementManagement } from '../api/contestApi'
import { useToast } from '@/components/ui/Toast'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'

type Option = ContestStatementManagement['problems'][number]['options'][number]
type Payload = ContestStatementManagement

export function ContestStatementManagementPage({ contestId, backPath }: { contestId: string; backPath?: string }) {
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
    try {
      const response = await getContestStatementManagement(contestId)
      setData(response)
      setSelection(Object.fromEntries(response.problems.map(problem => [problem.contestProblemId, {
        keys: [...problem.selected].sort((a, b) => a.orderIndex - b.orderIndex).map(item => item.key),
        defaultKey: problem.selected.find(item => item.isDefault)?.key || problem.selected[0]?.key || '',
      }])))
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载题面管理失败'
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }, [backPath, router, contestId])
  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => {
    if (!data) return []
    const map = new Map<string, { key: string; label: Option; cells: Record<string, Option> }>()
    for (const problem of data.problems) for (const option of problem.options) {
      const row = map.get(option.groupKey) || { key: option.groupKey, label: option, cells: {} }
      row.cells[problem.contestProblemId] = option
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
      const state = selection[problem.contestProblemId]
      if (!state?.keys.length || !state.keys.includes(state.defaultKey)) return toast.error(`${problem.alias || problem.orderIndex + 1} 题必须选择题面并指定默认版本`)
    }
    setSaving(true)
    const response = await saveContestStatementManagement(contestId, {
      selections: data.problems.map(problem => ({
        contestProblemId: problem.contestProblemId,
        visibleOptionKeys: selection[problem.contestProblemId].keys,
        defaultOptionKey: selection[problem.contestProblemId].defaultKey,
      })),
    })
    if (response.ok) { toast.success('活动题面配置已保存'); await load() }
    else toast.error(response.error.message || '保存失败')
    setSaving(false)
  }

  if (loading && !data) return <PageFrame><div className={unifiedStyles.u1}>正在加载题面矩阵…</div></PageFrame>
  if (!data) return <PageFrame><PageHeader title="题面选择无法加载" description={loadError || '活动题面数据暂时不可用'} actions={<Button variant="ghost" onClick={() => backPath ? router.replace(backPath) : router.back()}>返回活动</Button>} /></PageFrame>
  const matrixStyle = { '--statement-matrix-width': `${Math.max(900, 330 + data.problems.length * 150)}px` } as CSSProperties
  return (
    <PageFrame>
      <PageHeader title="题面选择" description={`${data.contest.title} · 为参赛者选择可用题面并指定默认版本`} actions={<div className={unifiedStyles.u2}><Button variant="ghost" onClick={() => backPath ? router.replace(backPath) : router.back()}>返回活动</Button><Button variant="ghost" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存题面选择'}</Button></div>} />
      <div className={unifiedStyles.u3}>点击空白/✓切换是否提供；点击星标设为默认。每道题可有多个 ✓，但只能有一个 ★。</div>
      <div className={unifiedStyles.u4}>
        <TableRoot className={unifiedStyles.matrixTable} style={matrixStyle}>
          <TableHead><TableRow><TableHeaderCell className={unifiedStyles.u5}>可用题面</TableHeaderCell>{data.problems.map(problem => <TableHeaderCell key={problem.contestProblemId} className={unifiedStyles.u6}>{problem.alias || String.fromCharCode(65 + problem.orderIndex)}</TableHeaderCell>)}</TableRow></TableHead>
          <TableBody>{rows.map(row => <TableRow key={row.key}>
            <TableCell className={unifiedStyles.u8}><strong>{row.label.name}</strong><div className={unifiedStyles.u9}>{row.label.authorUsername} · {row.label.visibility === 'mine' ? '我的' : row.label.visibility === 'frozen' ? '已固化' : row.key.startsWith('canonical:') ? '官方' : '公开'} · {row.label.language || '未知'} · {row.label.format.toUpperCase()}</div></TableCell>
            {data.problems.map(problem => {
              const option = row.cells[problem.contestProblemId]
              if (!option) return <TableCell key={problem.contestProblemId} className={unifiedStyles.u10}>—</TableCell>
              const state = selection[problem.contestProblemId]
              const included = state?.keys.includes(option.key)
              const isDefault = state?.defaultKey === option.key
              return <TableCell key={problem.contestProblemId} className={`${unifiedStyles.matrixCell} ${isDefault ? unifiedStyles.defaultCell : included ? unifiedStyles.includedCell : ''}`}>
                <Button variant="ghost" aria-label={`${problem.alias || problem.orderIndex + 1} ${row.label.name} ${included ? '取消提供' : '提供'}`} onClick={() => toggle(problem.contestProblemId, option.key)} className={`${unifiedStyles.matrixToggle} ${included ? unifiedStyles.matrixToggleIncluded : ''}`} disabled={isDefault}>{isDefault ? '★' : included ? '✓' : ''}</Button>
                {!isDefault && <Button variant="ghost" aria-label={`设为 ${problem.alias || problem.orderIndex + 1} 默认题面`} onClick={() => makeDefault(problem.contestProblemId, option.key)} className={unifiedStyles.u11}>☆</Button>}
              </TableCell>
            })}
          </TableRow>)}</TableBody>
        </TableRoot>
      </div>
    </PageFrame>
  )
}
