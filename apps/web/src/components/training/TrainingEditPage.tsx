'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { OJ_PLATFORMS_NO_ALL } from '@/lib/oj-platforms'

interface ResolvedProblem {
  found: boolean
  problemId: string
  title: string
  created: boolean
}

interface ProblemRow {
  id: string
  trainingProblemId?: string
  ojName: string
  problemCode: string
  alias: string
  points: number
  resolving: boolean
  resolved: ResolvedProblem | null
  existing?: boolean
}

interface TrainingInfo {
  id: string
  title: string
  description: string | null
  format: string
  startTime: string
  endTime: string
}

interface TrainingEditPageProps {
  basePath: string
}

let tempIdCounter = 0

export function TrainingEditPage({ basePath }: TrainingEditPageProps) {
  const params = useParams()
  const router = useRouter()
  const toast = useToast()
  const teamId = params.id as string
  const trainingId = params.tid as string

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [format, setFormat] = useState<'ioi' | 'icpc'>('ioi')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [originalStartTime, setOriginalStartTime] = useState<Date | null>(null)
  const [originalStartTimeStr, setOriginalStartTimeStr] = useState<string>('')

  // Problem management
  const [problemRows, setProblemRows] = useState<ProblemRow[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const resolveTimerRef = useRef<Record<string, NodeJS.Timeout>>({})

  // Load training data
  useEffect(() => {
    const loadTraining = async () => {
      try {
        setLoading(true)
        // Load training info
        const infoRes = await apiClient.get<TrainingInfo>(`/api/trainings/${trainingId}`)
        if (infoRes.success && infoRes.data) {
          const t = infoRes.data
          setTitle(t.title)
          setDescription(t.description || '')
          setFormat(t.format as 'ioi' | 'icpc')
          const startStr = new Date(t.startTime).toISOString().slice(0, 16)
          setStartTime(startStr)
          setEndTime(new Date(t.endTime).toISOString().slice(0, 16))
          setOriginalStartTime(new Date(t.startTime))
          setOriginalStartTimeStr(startStr)
        }

        // Load problems
        const problemsRes = await apiClient.get<any[]>(`/api/trainings/${trainingId}/problems`)
        if (problemsRes.success && problemsRes.data) {
          const rows: ProblemRow[] = problemsRes.data.map((p: any) => ({
            id: `existing-${p.id}`,
            trainingProblemId: p.id,
            ojName: p.platform || 'carits',
            problemCode: p.platformProblemId || p.problemId || '',
            alias: p.alias,
            points: p.points ?? 100,
            resolving: false,
            resolved: {
              found: true,
              problemId: p.problemId,
              title: p.problemTitle || '',
              created: false,
            },
            existing: true,
          }))
          setProblemRows(rows)
        }
      } catch (error) {
        toast.error('加载失败')
        router.back()
      } finally {
        setLoading(false)
      }
    }
    loadTraining()
  }, [trainingId])

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      Object.values(resolveTimerRef.current).forEach(clearTimeout)
    }
  }, [])

  const getLastOjPlatform = () => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('lastOjPlatform') : null
    if (saved) return saved
    return 'carits'
  }

  const addProblemRow = () => {
    const row: ProblemRow = {
      id: `temp-${++tempIdCounter}`,
      ojName: getLastOjPlatform(),
      problemCode: '',
      alias: String.fromCharCode(65 + problemRows.length),
      points: 100,
      resolving: false,
      resolved: null,
    }
    setProblemRows(prev => [...prev, row])
  }

  const updateRow = (rowId: string, updates: Partial<ProblemRow>) => {
    setProblemRows(prev => prev.map(r => r.id === rowId ? { ...r, ...updates } : r))
    if (updates.ojName) localStorage.setItem('lastOjPlatform', updates.ojName)
  }

  const removeRow = (rowId: string) => {
    if (resolveTimerRef.current[rowId]) {
      clearTimeout(resolveTimerRef.current[rowId])
      delete resolveTimerRef.current[rowId]
    }
    setProblemRows(prev => {
      const updated = prev.filter(r => r.id !== rowId)
      return updated.map((r, i) => ({ ...r, alias: String.fromCharCode(65 + i) }))
    })
  }

  const handleResolve = (row: ProblemRow) => {
    if (resolveTimerRef.current[row.id]) clearTimeout(resolveTimerRef.current[row.id])
    if (!row.problemCode.trim()) {
      updateRow(row.id, { resolved: null, resolving: false })
      return
    }
    updateRow(row.id, { resolving: true })
    resolveTimerRef.current[row.id] = setTimeout(async () => {
      try {
        const res = await apiClient.post(`/api/resolve-problems`, {
          items: [{ ojName: row.ojName, problemCode: row.problemCode.trim() }]
        })
        if (res.success && res.data) {
          const resolved = (res.data as any).resolved
          if (resolved && resolved.length > 0) {
            updateRow(row.id, { resolved: resolved[0], resolving: false })
          }
        }
      } catch {
        updateRow(row.id, { resolving: false })
      }
    }, 500)
  }

  const handleSave = async () => {
    if (!title.trim()) { toast.error('请输入标题'); return }
    if (!startTime || !endTime) { toast.error('请设置开始和结束时间'); return }
    if (new Date(endTime) <= new Date(startTime)) { toast.error('结束时间必须晚于开始时间'); return }

    // Check start time modification
    if (originalStartTime && originalStartTimeStr) {
      const now = new Date()
      const isStarted = now >= originalStartTime
      // Use string comparison to avoid timezone issues
      if (isStarted && startTime !== originalStartTimeStr) {
        toast.error('训练已经开始，不能修改开始时间')
        return
      }
    }

    // Check that all new resolved problems are found
    const newRows = problemRows.filter(r => !r.existing && r.problemCode.trim())
    const unresolvedRows = newRows.filter(r => !r.resolved || !r.resolved.found)
    if (unresolvedRows.length > 0) {
      toast.error(`有 ${unresolvedRows.length} 道题目未找到，请检查题号`)
      return
    }

    setSaving(true)
    try {
      // 1. Update training info
      const updateRes = await apiClient.put(`/api/trainings/${trainingId}`, {
        title, description, format, startTime, endTime,
      })
      if (!updateRes.success) {
        toast.error(updateRes.message || '更新失败')
        return
      }

      // 2. Remove deleted existing problems
      const existingIds = problemRows.filter(r => r.existing).map(r => r.trainingProblemId)
      const originalProblemsRes = await apiClient.get<any[]>(`/api/trainings/${trainingId}/problems`)
      if (originalProblemsRes.success && originalProblemsRes.data) {
        for (const orig of originalProblemsRes.data) {
          if (!existingIds.includes(orig.id)) {
            await apiClient.delete(`/api/trainings/${trainingId}/problems/${orig.id}`)
          }
        }
      }

      // 3. Update existing problems (alias, points)
      for (const row of problemRows.filter(r => r.existing)) {
        await apiClient.put(`/api/trainings/${trainingId}/problems/${row.trainingProblemId}`, {
          alias: row.alias,
          points: format === 'ioi' ? row.points : null,
        })
      }

      // 4. Add new problems
      for (const row of newRows.filter(r => r.resolved?.found)) {
        await apiClient.post(`/api/trainings/${trainingId}/problems`, {
          problemId: row.resolved!.problemId,
          alias: row.alias,
          points: format === 'ioi' ? row.points : null,
        })
      }

      toast.success('训练更新成功')
      router.push(`${basePath}/${teamId}/trainings/${trainingId}`)
    } catch (error) {
      toast.error('更新失败')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px',
    fontSize: '0.875rem', boxSizing: 'border-box',
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>加载中...</div>
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem' }}>
      <div style={{ maxWidth: '750px', margin: '0 auto' }}>
        <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>编辑训练</h2>
            <Button variant="secondary" onClick={() => router.back()}>取消</Button>
          </div>

          {/* Basic Info */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>标题 *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="训练标题" style={inputStyle} />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>公告</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="训练公告（可选）" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>赛制</label>
              <select value={format} onChange={e => setFormat(e.target.value as 'ioi' | 'icpc')} style={inputStyle}>
                <option value="ioi">IOI</option>
                <option value="icpc">ICPC</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>开始时间 *</label>
              <input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>结束时间 *</label>
              <input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Problems */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>题目列表</h3>

            {problemRows.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: '#fafafa' }}>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '36px' }}>#</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border)', width: '140px' }}>OJ</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border)', width: '100px' }}>题号</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>题目</th>
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '45px' }}>别名</th>
                      {format === 'ioi' && <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '55px' }}>分值</th>}
                      <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '40px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {problemRows.map((row, idx) => (
                      <tr key={row.id} style={{ borderBottom: '1px solid var(--gray-100)', background: row.existing ? '#fff' : '#fffbe6' }}>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '0.8rem' }}>{idx + 1}</td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>
                          <select value={row.ojName}
                            onChange={e => {
                              updateRow(row.id, { ojName: e.target.value, resolved: row.existing ? row.resolved : null })
                              if (!row.existing) handleResolve({ ...row, ojName: e.target.value, resolved: null })
                            }}
                            style={{ padding: '0.25rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', width: '100%' }}
                          >
                            {OJ_PLATFORMS_NO_ALL.map(oj => <option key={oj.value} value={oj.value}>{oj.label}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>
                          <input type="text" value={row.problemCode}
                            onChange={e => {
                              updateRow(row.id, { problemCode: e.target.value, resolved: row.existing ? row.resolved : null })
                              if (!row.existing) handleResolve({ ...row, problemCode: e.target.value })
                            }}
                            placeholder="输入题号"
                            disabled={row.existing}
                            style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'monospace', width: '100%', background: row.existing ? '#f5f5f5' : 'white' }}
                          />
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.existing ? (
                            <span><span style={{ color: '#10b981', fontSize: '0.75rem', marginRight: '0.25rem' }}>&#10003;</span><span style={{ color: 'var(--gray-600)', fontSize: '0.85rem' }}>{row.resolved?.title || '-'}</span></span>
                          ) : row.resolving
                            ? <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem' }}>检索中...</span>
                            : row.resolved
                              ? row.resolved.found
                                ? <span><span style={{ color: '#10b981', fontSize: '0.75rem', marginRight: '0.25rem' }}>&#10003;</span><span style={{ color: 'var(--primary)', fontSize: '0.85rem' }}>{row.resolved.title}</span></span>
                                : <span><span style={{ color: '#ef4444', fontSize: '0.75rem', marginRight: '0.25rem' }}>&#9888;</span><span style={{ color: '#ef4444', fontSize: '0.85rem' }}>题目不存在</span></span>
                              : <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem' }}>-</span>
                          }
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                          <input
                            value={row.alias}
                            onChange={e => updateRow(row.id, { alias: e.target.value })}
                            style={{ width: '36px', padding: '0.2rem', border: '1px solid var(--border)', borderRadius: '3px', textAlign: 'center', fontSize: '0.85rem' }}
                          />
                        </td>
                        {format === 'ioi' && (
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                            <input
                              type="number"
                              value={row.points}
                              onChange={e => updateRow(row.id, { points: parseInt(e.target.value) || 0 })}
                              style={{ width: '50px', padding: '0.2rem', border: '1px solid var(--border)', borderRadius: '3px', textAlign: 'center', fontSize: '0.85rem' }}
                            />
                          </td>
                        )}
                        <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                          <button onClick={() => removeRow(row.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '0.85rem', padding: '0.1rem 0.2rem' }} title="移除">&#10005;</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button onClick={addProblemRow}
              style={{ width: '100%', padding: '0.5rem', background: 'transparent', border: '1px dashed var(--border)', borderRadius: '6px', cursor: 'pointer', color: 'var(--gray-400)', fontSize: '0.85rem' }}>
              + 添加一道题目
            </button>

            {problemRows.length === 0 && (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--gray-400)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                点击上方按钮添加题目到训练中
              </div>
            )}
          </div>

          {/* Save Button */}
          <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存修改'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}