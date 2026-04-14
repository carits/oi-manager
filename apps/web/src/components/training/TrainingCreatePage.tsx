'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'

interface ProblemSearchResult {
  id: string
  platform: string
  problemId: string
  title: string
  difficulty: string | null
}

interface SelectedProblem {
  problemId: string
  alias: string
  points: number
  title: string
  platform: string
  platformProblemId: string
}

interface TrainingCreatePageProps {
  basePath: string
}

export function TrainingCreatePage({ basePath }: TrainingCreatePageProps) {
  const params = useParams()
  const router = useRouter()
  const toast = useToast()
  const teamId = params.id as string

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [format, setFormat] = useState<'ioi' | 'icpc'>('ioi')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')

  // Problem management
  const [selectedProblems, setSelectedProblems] = useState<SelectedProblem[]>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<ProblemSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState(false)

  // Search problems
  const handleSearch = useCallback(async () => {
    if (!searchKeyword.trim()) return
    setSearching(true)
    try {
      const res = await apiClient.get<{ problems: ProblemSearchResult[] }>(`/api/problems?keyword=${encodeURIComponent(searchKeyword)}&pageSize=20`)
      if (res.success && res.data) {
        setSearchResults(res.data.problems || [])
      }
    } catch (error) {
      console.error('Search error:', error)
    } finally {
      setSearching(false)
    }
  }, [searchKeyword])

  const addProblem = (problem: ProblemSearchResult) => {
    if (selectedProblems.some(p => p.problemId === problem.id)) return
    const nextAlias = String.fromCharCode(65 + selectedProblems.length) // A, B, C, ...
    setSelectedProblems(prev => [...prev, {
      problemId: problem.id,
      alias: nextAlias,
      points: 100,
      title: problem.title,
      platform: problem.platform,
      platformProblemId: problem.problemId,
    }])
  }

  const removeProblem = (index: number) => {
    setSelectedProblems(prev => {
      const updated = prev.filter((_, i) => i !== index)
      // Re-assign aliases
      return updated.map((p, i) => ({ ...p, alias: String.fromCharCode(65 + i) }))
    })
  }

  const updateProblem = (index: number, field: 'alias' | 'points', value: string | number) => {
    setSelectedProblems(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p))
  }

  const handleCreate = async () => {
    if (!title.trim()) { toast.error('请输入标题'); return }
    if (!startTime || !endTime) { toast.error('请设置开始和结束时间'); return }
    if (new Date(endTime) <= new Date(startTime)) { toast.error('结束时间必须晚于开始时间'); return }

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
      for (const p of selectedProblems) {
        await apiClient.post(`/api/trainings/${trainingId}/problems`, {
          problemId: p.problemId,
          alias: p.alias,
          points: p.points || null,
        })
      }

      toast.success('训练创建成功')
      router.push(`${basePath}/${teamId}/trainings/${trainingId}`)
    } catch (error) {
      toast.error('创建失败')
    } finally {
      setCreating(false)
    }
  }

  // Set default times
  useEffect(() => {
    if (!startTime) {
      const now = new Date()
      now.setMinutes(now.getMinutes() + 30)
      setStartTime(now.toISOString().slice(0, 16))
    }
    if (!endTime) {
      const later = new Date()
      later.setHours(later.getHours() + 5)
      setEndTime(later.toISOString().slice(0, 16))
    }
  }, [])

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px',
    fontSize: '0.875rem', boxSizing: 'border-box',
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-600)', fontSize: '0.875rem' }}>← 返回</button>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>创建训练</h1>
        </div>

        {/* Basic Info */}
        <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>基本信息</h2>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>标题 *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="训练标题" style={inputStyle} />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>公告</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="训练公告（可选）" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
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
        </div>

        {/* Problems */}
        <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>题目列表</h2>

          {/* Search */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              value={searchKeyword}
              onChange={e => setSearchKeyword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="搜索题目（题号或标题）"
              style={{ ...inputStyle, flex: 1 }}
            />
            <Button onClick={handleSearch} disabled={searching}>{searching ? '搜索中...' : '搜索'}</Button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', marginBottom: '1rem' }}>
              {searchResults.map(p => {
                const alreadyAdded = selectedProblems.some(sp => sp.problemId === p.id)
                return (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)', opacity: alreadyAdded ? 0.5 : 1 }}>
                    <div>
                      <span style={{ fontSize: '0.8rem', color: 'var(--primary)' }}>{p.problemId}</span>
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>{p.title}</span>
                      <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--gray-400)' }}>{p.platform}</span>
                    </div>
                    <button
                      onClick={() => !alreadyAdded && addProblem(p)}
                      disabled={alreadyAdded}
                      style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', background: alreadyAdded ? 'var(--gray-200)' : 'var(--primary)', color: alreadyAdded ? 'var(--gray-400)' : 'white', border: 'none', borderRadius: '4px', cursor: alreadyAdded ? 'default' : 'pointer' }}
                    >
                      {alreadyAdded ? '已添加' : '添加'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Selected Problems */}
          {selectedProblems.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>别名</th>
                  <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>题目</th>
                  {format === 'ioi' && <th style={{ padding: '0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>分值</th>}
                  <th style={{ padding: '0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {selectedProblems.map((p, i) => (
                  <tr key={i}>
                    <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                      <input
                        value={p.alias}
                        onChange={e => updateProblem(i, 'alias', e.target.value)}
                        style={{ width: '50px', padding: '0.25rem', border: '1px solid var(--border)', borderRadius: '3px', textAlign: 'center', fontSize: '0.85rem' }}
                      />
                    </td>
                    <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--primary)', fontSize: '0.8rem' }}>{p.platformProblemId}</span>
                      <span style={{ marginLeft: '0.25rem' }}>{p.title}</span>
                    </td>
                    {format === 'ioi' && (
                      <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                        <input
                          type="number"
                          value={p.points}
                          onChange={e => updateProblem(i, 'points', parseInt(e.target.value) || 0)}
                          style={{ width: '60px', padding: '0.25rem', border: '1px solid var(--border)', borderRadius: '3px', textAlign: 'center', fontSize: '0.85rem' }}
                        />
                      </td>
                    )}
                    <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                      <button onClick={() => removeProblem(i)} style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', fontSize: '0.85rem' }}>移除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedProblems.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-400)', fontSize: '0.85rem' }}>
              搜索并添加题目到训练中
            </div>
          )}
        </div>

        {/* Submit */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <Button variant="secondary" onClick={() => router.back()}>取消</Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? '创建中...' : '创建训练'}
          </Button>
        </div>
      </div>
    </div>
  )
}
