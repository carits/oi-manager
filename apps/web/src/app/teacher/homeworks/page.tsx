'use client'

import { useCallback, useEffect, useState } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import apiClient from '@/lib/apiClient'
import TeamTrainingList from '@/components/training/TeamTrainingList'
import { Empty } from '@/components/ui/Empty'
import { LoadError } from '@/components/ui/LoadError'

interface Team {
  id: string
  name: string
  avatar: string | null
}

export default function TeacherHomeworksPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null)

  const loadTeams = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiClient.get('/api/teams?view=mine&pageSize=100')
      if (res.success) {
        const payload = res.data as any
        const list: Team[] = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.items)
            ? payload.items
            : Array.isArray(payload?.data)
              ? payload.data
              : []
        setTeams(list)
        if (list.length > 0) setActiveTeamId(list[0].id)
      } else {
        setError(res.message || '团队加载失败')
      }
    } catch {
      setError('团队加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTeams()
  }, [loadTeams])

  const activeTeam = teams.find(t => t.id === activeTeamId)

  return (
    <ProtectedRoute requiredRole="teacher">
        <div style={{ padding: '2rem' }}>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: '1.5rem' }}>作业</h1>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>加载中...</div>
          ) : error ? (
            <LoadError message={error} onRetry={loadTeams} />
          ) : teams.length === 0 ? (
            <Empty text="暂无团队，请先创建团队" />
          ) : (
            <>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {teams.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTeamId(t.id)}
                    style={{
                      padding: '0.4rem 0.8rem',
                      borderRadius: 'var(--radius)',
                      border: `1px solid ${t.id === activeTeamId ? 'var(--primary)' : 'var(--border)'}`,
                      background: t.id === activeTeamId ? 'var(--primary-light)' : 'var(--bg-card)',
                      color: t.id === activeTeamId ? 'var(--primary-text)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      fontWeight: t.id === activeTeamId ? 600 : 400,
                    }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>

              {activeTeam && (
                <TeamTrainingList
                  teamId={activeTeam.id}
                  basePath="/teacher/teams"
                  isAdmin={true}
                  mode="homework"
                />
              )}
            </>
          )}
        </div>
    </ProtectedRoute>
  )
}
