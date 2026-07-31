'use client'

import { useCallback, useEffect, useState } from 'react'
import apiClient from '@/lib/apiClient'
import { Empty } from '@/components/ui/Empty'
import { LoadError } from '@/components/ui/LoadError'

interface ContestItem {
  id: number
  title: string
  description: string | null
  startTime: string
  endTime: string
  status: string
  format: string
  teamId: string | null
  schoolId: string | null
  problemCount: number
  source: 'team' | 'school'
  createdAt: string
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  upcoming: { label: '未开始', color: 'var(--info)' },
  ongoing: { label: '进行中', color: 'var(--success)' },
  finished: { label: '已结束', color: 'var(--text-muted)' },
}

function getRuntimeStatus(startTime: string, endTime: string) {
  const now = new Date()
  const start = new Date(startTime)
  const end = new Date(endTime)
  if (now < start) return 'upcoming'
  if (now <= end) return 'ongoing'
  return 'finished'
}

function formatTime(t: string) {
  return new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function StudentContestsPage() {
  const [contests, setContests] = useState<ContestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadContests = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiClient.get<ContestItem[]>('/api/students/my-contests')
      if (res.success) {
        setContests(res.data || [])
      } else {
        setError(res.message || '比赛加载失败')
      }
    } catch {
      setError('比赛加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadContests()
  }, [loadContests])

  return (
    <>
        <div style={{ padding: '2rem' }}>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: '1.5rem' }}>比赛</h1>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}><span className="resource-skeleton-line" style={{ display: 'inline-block', width: '8rem' }} aria-label="内容正在准备" /></div>
          ) : error ? (
            <LoadError message={error} onRetry={loadContests} />
          ) : contests.length === 0 ? (
            <Empty text="暂无比赛" />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {contests.map(c => {
                const status = c.status || getRuntimeStatus(c.startTime, c.endTime)
                const st = STATUS_MAP[status] || STATUS_MAP.upcoming
                return (
                  <a
                    key={c.id}
                    href={`/student/contests/${c.id}`}
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
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{c.title}</span>
                      <span style={{ fontSize: '0.75rem', color: st.color, fontWeight: 500 }}>{st.label}</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {formatTime(c.startTime)} ~ {formatTime(c.endTime)}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.problemCount} 题</span>
                      {c.source === 'school' && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--info)', background: 'var(--info-light)', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)' }}>校级</span>
                      )}
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
