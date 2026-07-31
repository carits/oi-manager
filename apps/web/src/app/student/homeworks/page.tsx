'use client'

import { useCallback, useEffect, useState } from 'react'
import apiClient from '@/lib/apiClient'
import { LoadError } from '@/components/ui/LoadError'

interface HomeworkItem {
  id: number
  title: string
  description: string | null
  startTime: string
  endTime: string
  status: string
  format: string
  teamId: string
  problemCount: number
  createdAt: string
}

export default function StudentHomeworksPage() {
  const [homeworks, setHomeworks] = useState<HomeworkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadHomeworks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiClient.get<HomeworkItem[]>('/api/students/my-homeworks')
      if (res.success) {
        setHomeworks(res.data || [])
      } else {
        setError(res.message || '作业加载失败')
      }
    } catch {
      setError('作业加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHomeworks()
  }, [loadHomeworks])

  const getStatusLabel = (startTime: string, endTime: string) => {
    const now = new Date()
    const start = new Date(startTime)
    const end = new Date(endTime)
    if (now < start) return { label: '未开始', color: 'var(--info)' }
    if (now <= end) return { label: '进行中', color: 'var(--success)' }
    return { label: '已结束', color: 'var(--text-muted)' }
  }

  const formatTime = (t: string) => new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <>
        <div style={{ padding: '2rem' }}>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: '1.5rem' }}>作业</h1>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}><span className="resource-skeleton-line" style={{ display: 'inline-block', width: '8rem' }} aria-label="内容正在准备" /></div>
          ) : error ? (
            <LoadError message={error} onRetry={loadHomeworks} />
          ) : homeworks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <p>暂无作业</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {homeworks.map(hw => {
                const st = getStatusLabel(hw.startTime, hw.endTime)
                return (
                  <a
                    key={hw.id}
                    href={`/student/homeworks/${hw.id}`}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      padding: '1rem',
                      background: 'var(--bg-card)',
                      textDecoration: 'none',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{hw.title}</span>
                      <span style={{ fontSize: '0.75rem', color: st.color, fontWeight: 500 }}>{st.label}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {formatTime(hw.startTime)} ~ {formatTime(hw.endTime)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 'auto' }}>
                      {hw.problemCount} 题
                    </div>
                  </a>
                )
              })}
            </div>
          )}
        </div>
    </>
  )
}
