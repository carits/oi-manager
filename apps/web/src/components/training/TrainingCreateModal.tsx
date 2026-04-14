'use client'

import { useState, useEffect, useRef } from 'react'
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
  ojName: string
  problemCode: string
  alias: string
  points: number
  resolving: boolean
  resolved: ResolvedProblem | null
}

interface TrainingCreateModalProps {
  isOpen: boolean
  onClose: () => void
  teamId: string
  onCreated?: (trainingId: string) => void
}

let tempIdCounter = 0

export function TrainingCreateModal({ isOpen, onClose, teamId, onCreated }: TrainingCreateModalProps) {
  const toast = useToast()

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [format, setFormat] = useState<'ioi' | 'icpc'>('ioi')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')

  // Problem management
  const [problemRows, setProblemRows] = useState<ProblemRow[]>([])
  const [creating, setCreating] = useState(false)
  const resolveTimerRef = useRef<Record<string, NodeJS.Timeout>>({})

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setDescription('')
      setFormat('ioi')
      setProblemRows([])
      setCreating(false)

      const now = new Date()
      now.setMinutes(now.getMinutes() + 30)
      setStartTime(now.toISOString().slice(0, 16))

      const later = new Date()
      later.setHours(later.getHours() + 5)
      setEndTime(later.toISOString().slice(0, 16))
    }
  }, [isOpen])

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

  const handleCreate = async () => {
    if (!title.trim()) { toast.error('请输入标题'); return }
    if (!startTime || !endTime) { toast.error('请设置开始和结束时间'); return }
    if (new Date(endTime) <= new Date(startTime)) { toast.error('结束时间必须晚于开始时间'); return }

    // Check that all resolved problems are found
    const unresolvedRows = problemRows.filter(r => r.problemCode.trim() && (!r.resolved || !r.resolved.found))
    if (unresolvedRows.length > 0) {
      toast.error(`有 ${unresolvedRows.length} 道题目未找到，请检查题号`)
      return
    }

    const resolvedRows = problemRows.filter(r => r.resolved?.found)
    if (resolvedRows.length === 0 && problemRows.some(r => r.problemCode.trim())) {
      toast.error('题目未能解析，请稍候重试')
      return
    }

    setCreating(true)
    try {
      // 1. Create training
      const res = await apiClient.post(`/api/teams/${teamId}/trainings`, {
        title, description, format, startTime, endTime,
      })
      if (!res.success || !res.data) {
        toast.error(res.message || '创建失败')
        return
      }

      const trainingId = (res.data as any).id

      // 2. Add problems
      for (const row of resolvedRows) {
        await apiClient.post(`/api/trainings/${trainingId}/problems`, {
          problemId: row.resolved!.problemId,
          alias: row.alias,
          points: format === 'ioi' ? row.points : null,
        })
      }

      toast.success('训练创建成功')
      onClose()
      onCreated?.(trainingId)
    } catch (error) {
      toast.error('创建失败')
    } finally {
      setCreating(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px',
    fontSize: '0.875rem', boxSizing: 'border-box',
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="创建训练"
      width="750px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? '创建中...' : '创建训练'}
          </Button>
        </div>
      }
    >
      <div style={{ maxHeight: '70vh', overflowY: 'auto', padding: '0 0.25rem' }}>
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
                    <tr key={row.id} style={{ borderBottom: '1px solid var(--gray-100)', background: '#fffbe6' }}>
                      <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '0.8rem' }}>{idx + 1}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>
                        <select value={row.ojName}
                          onChange={e => {
                            updateRow(row.id, { ojName: e.target.value, resolved: null })
                            handleResolve({ ...row, ojName: e.target.value, resolved: null })
                          }}
                          style={{ padding: '0.25rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', width: '100%' }}
                        >
                          {OJ_PLATFORMS_NO_ALL.map(oj => <option key={oj.value} value={oj.value}>{oj.label}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>
                        <input type="text" value={row.problemCode}
                          onChange={e => {
                            updateRow(row.id, { problemCode: e.target.value, resolved: null })
                            handleResolve({ ...row, problemCode: e.target.value })
                          }}
                          placeholder="输入题号"
                          style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'monospace', width: '100%' }}
                        />
                      </td>
                      <td style={{ padding: '0.4rem 0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.resolving
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
      </div>
    </Modal>
  )
}
