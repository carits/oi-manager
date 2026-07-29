'use client'

import { useEffect, useState } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import TeamTrainingList from '@/components/training/TeamTrainingList'
import { Empty } from '@/components/ui/Empty'

interface Team {
  id: string
  name: string
  avatar: string | null
}

export default function TeacherHomeworksPage() {
  const { user } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null)

  useEffect(() => {
    apiClient.get('/api/teams?view=mine&pageSize=100').then(res => {
      if (res.success) {
        const list: Team[] = (res.data as any)?.items || res.data || []
        setTeams(list)
        if (list.length > 0) setActiveTeamId(list[0].id)
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const activeTeam = teams.find(t => t.id === activeTeamId)

  return (
    <ProtectedRoute requiredRole="teacher">
        <div style={{ padding: '2rem' }}>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: '1.5rem' }}>作业</h1>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>加载中...</div>
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
