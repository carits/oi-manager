'use client'

import { useState, useEffect, useRef } from 'react'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { OJ_PLATFORMS_NO_ALL } from '@/lib/oj-platforms'

function toLocalDatetimeString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

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

interface TrainingFormModalProps {
  isOpen: boolean
  onClose: () => void
  teamId?: string
  schoolId?: string
  organizationId?: string
  trainingId?: string
  onSaved?: () => void
  mode?: 'training' | 'contest' | 'homework'
}

let tempIdCounter = 0

export function TrainingFormModal({ isOpen, onClose, teamId, schoolId, organizationId, trainingId, onSaved, mode = 'training' }: TrainingFormModalProps) {
  const toast = useToast()
  const isEdit = !!trainingId

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [format, setFormat] = useState<'oi' | 'ioi' | 'icpc'>('ioi')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [problemIdVisible, setProblemIdVisible] = useState(false)
  const [solutionVisible, setSolutionVisible] = useState(false)
  const [includeAdminInRanking, setIncludeAdminInRanking] = useState(false)
  const [originalStartTime, setOriginalStartTime] = useState<Date | null>(null)
  const [originalStartTimeStr, setOriginalStartTimeStr] = useState<string>('')

  // Problem management
  const [problemRows, setProblemRows] = useState<ProblemRow[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const resolveTimerRef = useRef<Record<string, NodeJS.Timeout>>({})

  // Reset / load data when modal opens
  useEffect(() => {
    if (!isOpen) return

    if (isEdit && trainingId) {
      // 编辑模式：加载已有数据
      const loadTraining = async () => {
        setLoading(true)
        try {
          const infoRes = await apiClient.get(`/api/trainings/${trainingId}`)
          if (infoRes.success && infoRes.data) {
            const t = infoRes.data as any
            setTitle(t.title)
            setDescription(t.description || '')
            setFormat(t.format as 'ioi' | 'icpc')
            setProblemIdVisible(t.problemIdVisible ?? false)
            setSolutionVisible(t.solutionVisible ?? false)
            setIncludeAdminInRanking(t.includeAdminInRanking ?? false)
            const startStr = toLocalDatetimeString(new Date(t.startTime))
            setStartTime(startStr)
            setEndTime(toLocalDatetimeString(new Date(t.endTime)))
            setOriginalStartTime(new Date(t.startTime))
            setOriginalStartTimeStr(startStr)
          }

          const problemsRes = await apiClient.get(`/api/trainings/${trainingId}/problems`)
          if (problemsRes.success && problemsRes.data) {
            const rows: ProblemRow[] = (problemsRes.data as any[]).map((p: any) => ({
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
        } catch {
          toast.error('加载失败')
        } finally {
          setLoading(false)
        }
      }
      loadTraining()
    } else {
      // 创建模式：空表单
      setTitle('')
      setDescription('')
      setFormat('ioi')
      setProblemIdVisible(false)
      setSolutionVisible(false)
      setIncludeAdminInRanking(false)
      setProblemRows([])
      setSaving(false)
      setOriginalStartTime(null)
      setOriginalStartTimeStr('')

      const now = new Date()
      let hours = now.getHours()
      const minutes = now.getMinutes()
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())

      if (minutes > 0) hours += 1
      if (hours >= 22) {
        date.setDate(date.getDate() + 1)
        hours = 8
      }
      date.setHours(hours, 0, 0, 0)

      setStartTime(toLocalDatetimeString(date))
      const end = new Date(date)
      end.setHours(end.getHours() + 3)
      setEndTime(toLocalDatetimeString(end))
    }
  }, [isOpen, trainingId])

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
      alias: '',
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
    setProblemRows(prev => prev.filter(r => r.id !== rowId))
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

  const moveUp = (idx: number) => {
    if (idx === 0) return
    const rows = [...problemRows]
    const temp = rows[idx - 1]
    rows[idx - 1] = rows[idx]
    rows[idx] = temp
    setProblemRows(rows)
  }

  const moveDown = (idx: number) => {
    if (idx === problemRows.length - 1) return
    const rows = [...problemRows]
    const temp = rows[idx]
    rows[idx] = rows[idx + 1]
    rows[idx + 1] = temp
    setProblemRows(rows)
  }

  const handleSave = async () => {
    if (!title.trim()) { toast.error('请输入标题'); return }
    if (!startTime || !endTime) { toast.error('请设置开始和结束时间'); return }
    if (new Date(endTime) <= new Date(startTime)) { toast.error('结束时间必须晚于开始时间'); return }

    if (isEdit) {
      // 编辑模式验证
      const isStarted = originalStartTime ? new Date() >= originalStartTime : false
      if (isStarted && startTime !== originalStartTimeStr) {
        toast.error('训练已经开始，不能修改开始时间')
        return
      }
      if (!isStarted && startTime !== originalStartTimeStr && new Date(startTime) <= new Date()) {
        toast.error('开始时间不能早于当前时间')
        return
      }
      if (new Date(endTime) <= new Date()) {
        toast.error('结束时间不能早于当前时间')
        return
      }

      const newRows = problemRows.filter(r => !r.existing && r.problemCode.trim())
      const unresolvedRows = newRows.filter(r => !r.resolved || !r.resolved.found)
      if (unresolvedRows.length > 0) {
        toast.error(`有 ${unresolvedRows.length} 道题目未找到，请检查题号`)
        return
      }
    } else {
      // 创建模式验证
      if (new Date(startTime) <= new Date()) { toast.error('开始时间不能早于当前时间'); return }

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
    }

    setSaving(true)
    try {
      if (isEdit && trainingId) {
        // === 编辑模式 ===
        // 1. Update training info
        const updateRes = await apiClient.put(`/api/trainings/${trainingId}`, {
          title, description, format,
          problemIdVisible, solutionVisible, includeAdminInRanking,
          ...(startTime !== originalStartTimeStr && {
            startTime: new Date(startTime).toISOString(),
          }),
          endTime: new Date(endTime).toISOString(),
        })
        if (!updateRes.success) {
          toast.error(updateRes.message || '更新失败')
          return
        }

        // 2. Remove deleted existing problems
        const existingIds = problemRows.filter(r => r.existing).map(r => r.trainingProblemId)
        const originalProblemsRes = await apiClient.get(`/api/trainings/${trainingId}/problems`)
        if (originalProblemsRes.success && originalProblemsRes.data) {
          for (const orig of originalProblemsRes.data as any[]) {
            if (!existingIds.includes(orig.id)) {
              await apiClient.delete(`/api/trainings/${trainingId}/problems/${orig.id}`)
            }
          }
        }

        // 3. Update existing problems (alias, points)
        for (const row of problemRows.filter(r => r.existing)) {
          await apiClient.put(`/api/trainings/${trainingId}/problems/${row.trainingProblemId}`, {
            alias: row.alias,
            points: (format === 'ioi' || format === 'oi') ? row.points : null,
          })
        }

        // 4. Add new problems
        const newRows = problemRows.filter(r => !r.existing && r.resolved?.found)
        const newTrainingProblemIds: string[] = []
        for (const row of newRows) {
          const createRes = await apiClient.post(`/api/trainings/${trainingId}/problems`, {
            problemId: row.resolved!.problemId,
            alias: row.alias,
            points: (format === 'ioi' || format === 'oi') ? row.points : null,
          })
          if (createRes.success && createRes.data) {
            newTrainingProblemIds.push((createRes.data as any).id)
          }
        }

        // 5. Reorder
        const existingIdsInOrder = problemRows.filter(r => r.existing).map(r => r.trainingProblemId!)
        const allIdsInOrder = [...existingIdsInOrder, ...newTrainingProblemIds]
        const orders = allIdsInOrder.map((id, i) => ({ id, orderIndex: i }))
        if (orders.length > 0) {
          await apiClient.put(`/api/trainings/${trainingId}/problems/reorder`, { orders })
        }

        toast.success(`${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}更新成功`)
      } else {
        const createUrl = organizationId
          ? '/api/organizations/' + organizationId + '/members/activities/contests'
          : '/api/teams/' + teamId + '/trainings'
        const res = await apiClient.post(createUrl, {
          title, description, format, type: mode,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          problemIdVisible, solutionVisible, includeAdminInRanking,
        })
        if (!res.success || !res.data) {
          toast.error(res.message || '创建失败')
          return
        }

        const newTrainingId = (res.data as any).id

        const resolvedRows = problemRows.filter(r => r.resolved?.found)
        for (const row of resolvedRows) {
          await apiClient.post(`/api/trainings/${newTrainingId}/problems`, {
            problemId: row.resolved!.problemId,
            alias: row.alias,
            points: (format === 'ioi' || format === 'oi') ? row.points : null,
          })
        }

        // 创建后也 reorder（确保顺序正确）
        if (resolvedRows.length > 0) {
          // 获取刚创建的题目以拿到 ID
          const problemsRes = await apiClient.get(`/api/trainings/${newTrainingId}/problems`)
          if (problemsRes.success && problemsRes.data) {
            const createdProblems = problemsRes.data as any[]
            const orders = createdProblems.map((p: any, i: number) => ({ id: p.id, orderIndex: i }))
            if (orders.length > 0) {
              await apiClient.put(`/api/trainings/${newTrainingId}/problems/reorder`, { orders })
            }
          }
        }

        toast.success(schoolId ? '比赛创建成功' : '训练创建成功')
      }

      onClose()
      onSaved?.()
    } catch {
      toast.error(isEdit ? '更新失败' : '创建失败')
    } finally {
      setSaving(false)
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
      title={isEdit ? `编辑${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}` : `创建${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}`}
      width="960px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? (isEdit ? '保存中...' : '创建中...') : (isEdit ? '保存修改' : `创建${mode === 'contest' ? '比赛' : mode === 'homework' ? '作业' : '训练'}`)}
          </Button>
        </div>
      }
    >
      <div style={{ maxHeight: '70vh', overflowY: 'auto', padding: '0 0.25rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-400)' }}><span className="resource-skeleton-line" style={{ display: 'inline-block', width: '8rem' }} aria-label="内容正在准备" /></div>
        ) : (
          <>
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
                <select aria-label="选择" value={format} onChange={e => setFormat(e.target.value as 'oi' | 'ioi' | 'icpc')} style={inputStyle}>
                  <option value="ioi">IOI（即时反馈+部分分）</option>
                  <option value="icpc">ICPC（即时反馈+AC/罚时）</option>
                  <option value="oi">OI（赛中不反馈，赛后统一公布）</option>
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

            {/* 可见性设置 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>题目来源显示</label>
                <select aria-label="选择" value={problemIdVisible ? 'always' : 'after'} onChange={e => setProblemIdVisible(e.target.value === 'always')} style={inputStyle}>
                  <option value="after">赛后显示</option>
                  <option value="always">始终显示</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>题解显示</label>
                <select aria-label="选择" value={solutionVisible ? 'always' : 'after'} onChange={e => setSolutionVisible(e.target.value === 'always')} style={inputStyle}>
                  <option value="after">赛后显示</option>
                  <option value="always">始终显示</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>管理员排名</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginTop: '0.5rem' }}>
                  <input type="checkbox" checked={includeAdminInRanking} onChange={e => setIncludeAdminInRanking(e.target.checked)} style={{ width: '1rem', height: '1rem' }} />
                  <span style={{ fontSize: '0.85rem' }}>包含管理员</span>
                </label>
              </div>
            </div>

            {/* Problems */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>题目列表</h3>

              {problemRows.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-muted)' }}>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '64px' }}>排序</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '36px' }}>#</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border)', width: '130px' }}>OJ</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border)', width: '120px' }}>题号</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>题目</th>
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '70px' }}>别名</th>
                        {(format === 'ioi' || format === 'oi') && <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '65px' }}>分值</th>}
                        <th style={{ padding: '0.4rem 0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)', width: '40px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {problemRows.map((row, idx) => (
                        <tr key={row.id} style={{ borderBottom: '1px solid var(--gray-100)', background: row.existing ? 'var(--text-inverse)' : '#fffbe6' }}>
                          <td style={{ padding: '0.4rem 0.25rem', textAlign: 'center' }}>
                            <button
                              onClick={() => moveUp(idx)}
                              disabled={idx === 0}
                              style={{
                                background: idx === 0 ? 'var(--bg-muted)' : 'white',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                cursor: idx === 0 ? 'not-allowed' : 'pointer',
                                padding: '0.15rem 0.35rem',
                                fontSize: '0.7rem',
                                marginRight: '2px',
                                color: idx === 0 ? 'var(--border)' : '#666',
                              }}
                              title="上移"
                            >↑</button>
                            <button
                              onClick={() => moveDown(idx)}
                              disabled={idx === problemRows.length - 1}
                              style={{
                                background: idx === problemRows.length - 1 ? 'var(--bg-muted)' : 'white',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                cursor: idx === problemRows.length - 1 ? 'not-allowed' : 'pointer',
                                padding: '0.15rem 0.35rem',
                                fontSize: '0.7rem',
                                color: idx === problemRows.length - 1 ? 'var(--border)' : '#666',
                              }}
                              title="下移"
                            >↓</button>
                          </td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '0.8rem' }}>{idx + 1}</td>
                          <td style={{ padding: '0.4rem 0.5rem' }}>
                            <select aria-label="选择" value={row.ojName}
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
                              style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'monospace', width: '100%', background: row.existing ? 'var(--bg-muted)' : 'white' }}
                            />
                          </td>
                          <td style={{ padding: '0.4rem 0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.existing ? (
                              <span><span style={{ color: 'var(--success)', fontSize: '0.75rem', marginRight: '0.25rem' }}>&#10003;</span><span style={{ color: 'var(--gray-600)', fontSize: '0.85rem' }}>{row.resolved?.title || '-'}</span></span>
                            ) : row.resolving
                              ? <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem' }}>检索中...</span>
                              : row.resolved
                                ? row.resolved.found
                                  ? <span><span style={{ color: 'var(--success)', fontSize: '0.75rem', marginRight: '0.25rem' }}>&#10003;</span><span style={{ color: 'var(--primary)', fontSize: '0.85rem' }}>{row.resolved.title}</span></span>
                                  : <span><span style={{ color: 'var(--error)', fontSize: '0.75rem', marginRight: '0.25rem' }}>&#9888;</span><span style={{ color: 'var(--error)', fontSize: '0.85rem' }}>题目不存在</span></span>
                                : <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem' }}>-</span>
                            }
                          </td>
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                            <input
                              value={row.alias}
                              onChange={e => updateRow(row.id, { alias: e.target.value })}
                              style={{ width: '60px', padding: '0.2rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontSize: '0.85rem' }}
                            />
                          </td>
                          {(format === 'ioi' || format === 'oi') && (
                            <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                              <input
                                type="number"
                                value={row.points}
                                onChange={e => updateRow(row.id, { points: parseInt(e.target.value) || 0 })}
                                style={{ width: '58px', padding: '0.2rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontSize: '0.85rem' }}
                              />
                            </td>
                          )}
                          <td style={{ padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                            <button onClick={() => removeRow(row.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', fontSize: '0.85rem', padding: '0.1rem 0.2rem' }} title="移除">&#10005;</button>
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
          </>
        )}
      </div>
    </Modal>
  )
}
