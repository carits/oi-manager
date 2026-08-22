'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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

export function TrainingStatementManagementPage({ trainingId }: { trainingId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selection, setSelection] = useState<Record<string, { keys: string[]; defaultKey: string }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    const response = await apiClient.get<Payload>(`/api/trainings/${trainingId}/statement-management`)
    if (!response.success || !response.data) toast.error(response.message || '加载题面管理失败')
    else {
      setData(response.data)
      setSelection(Object.fromEntries(response.data.problems.map(problem => [problem.trainingProblemId, {
        keys: [...problem.selected].sort((a, b) => a.orderIndex - b.orderIndex).map(item => item.key),
        defaultKey: problem.selected.find(item => item.isDefault)?.key || problem.selected[0]?.key || '',
      }])))
    }
    setLoading(false)
  }, [trainingId, toast])
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
    const response = await apiClient.put(`/api/trainings/${trainingId}/statement-management`, {
      selections: data.problems.map(problem => ({ trainingProblemId: problem.trainingProblemId, visibleOptionKeys: selection[problem.trainingProblemId].keys, defaultOptionKey: selection[problem.trainingProblemId].defaultKey })),
    })
    if (response.success) { toast.success('活动题面配置已保存'); await load() }
    else toast.error(response.message || '保存失败')
    setSaving(false)
  }

  if (loading && !data) return <PageFrame><div style={{ padding: '4rem', textAlign: 'center' }}>正在加载题面矩阵…</div></PageFrame>
  if (!data) return <PageFrame><div style={{ padding: '4rem', textAlign: 'center' }}>题面选择无法加载</div></PageFrame>
  return (
    <PageFrame>
      <PageHeader title="题面选择" description={`${data.training.title} · 为参赛者选择可用题面并指定默认版本`} actions={<div style={{ display: 'flex', gap: '0.6rem' }}><button onClick={() => router.back()}>返回活动</button><button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存题面选择'}</button></div>} />
      <div style={{ marginTop: '1rem', padding: '0.8rem 1rem', background: 'var(--info-light)', borderRadius: '8px', color: 'var(--text-secondary)' }}>点击空白/✓切换是否提供；点击星标设为默认。每道题可有多个 ✓，但只能有一个 ★。</div>
      <div style={{ marginTop: '1rem', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '10px', maxHeight: 'calc(100vh - 260px)' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: Math.max(900, 330 + data.problems.length * 150), width: '100%' }}>
          <thead><tr><th style={{ position: 'sticky', left: 0, top: 0, zIndex: 3, background: 'var(--gray-100)', padding: '0.8rem', textAlign: 'left', width: '310px' }}>题面版本</th>{data.problems.map(problem => <th key={problem.trainingProblemId} style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--gray-100)', padding: '0.8rem', minWidth: '140px' }}>{problem.alias || String.fromCharCode(65 + problem.orderIndex)}<div style={{ fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-muted)' }}>rev {problem.selectionRevision}</div></th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.key}>
            <td style={{ position: 'sticky', left: 0, zIndex: 1, background: 'white', borderTop: '1px solid var(--border)', padding: '0.75rem' }}><strong>{row.label.name}</strong><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{row.label.authorUsername} · {row.label.visibility === 'mine' ? '我的' : row.label.visibility === 'frozen' ? '已固化' : row.key.startsWith('canonical:') ? '官方' : '公开'} · {row.label.language || '未知'} · {row.label.format.toUpperCase()}</div></td>
            {data.problems.map(problem => {
              const option = row.cells[problem.trainingProblemId]
              if (!option) return <td key={problem.trainingProblemId} style={{ borderTop: '1px solid var(--border)', textAlign: 'center', background: 'var(--gray-50)', color: 'var(--gray-300)', fontSize: '1.2rem' }}>—</td>
              const state = selection[problem.trainingProblemId]
              const included = state?.keys.includes(option.key)
              const isDefault = state?.defaultKey === option.key
              return <td key={problem.trainingProblemId} style={{ borderTop: '1px solid var(--border)', textAlign: 'center', padding: '0.4rem', background: isDefault ? '#fff8d9' : included ? '#eef8ef' : 'white' }}>
                <button aria-label={`${problem.alias || problem.orderIndex + 1} ${row.label.name} ${included ? '取消提供' : '提供'}`} onClick={() => toggle(problem.trainingProblemId, option.key)} style={{ width: '42px', height: '34px', border: '1px solid var(--border)', borderRadius: '6px', background: included ? 'var(--success-light)' : 'white', cursor: isDefault ? 'not-allowed' : 'pointer' }}>{isDefault ? '★' : included ? '✓' : ''}</button>
                {!isDefault && <button aria-label={`设为 ${problem.alias || problem.orderIndex + 1} 默认题面`} onClick={() => makeDefault(problem.trainingProblemId, option.key)} style={{ marginLeft: '0.25rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--warning)' }}>☆</button>}
              </td>
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </PageFrame>
  )
}
