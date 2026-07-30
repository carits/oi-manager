'use client'

import { useCallback, useEffect, useState } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import TeamTrainingList from '@/components/training/TeamTrainingList'
import { Empty } from '@/components/ui/Empty'
import { LoadError } from '@/components/ui/LoadError'

interface Team {
  id: string
  name: string
  avatar: string | null
}

export default function TeacherContestsPage() {
  const { user } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null)
  const [showSchool, setShowSchool] = useState(false)
  const schoolId = user?.schoolId || null

  const loadTeams = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiClient.get('/api/teams?view=mine&pageSize=100')
      if (res.success) {
        const list: Team[] = (res.data as any)?.items || res.data || []
        setTeams(list)
        if (list.length > 0) setActiveTeamId(list[0].id)
      } else {
        setError(res.message || '比赛范围加载失败')
      }
    } catch {
      setError('比赛范围加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTeams()
  }, [loadTeams])

  const showSchoolTab = !!schoolId

  return (
    <ProtectedRoute requiredRole="teacher">
        <div style={{ padding: '2rem' }}>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: '1.5rem' }}>比赛</h1>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>加载中...</div>
          ) : error ? (
            <LoadError message={error} onRetry={loadTeams} />
          ) : teams.length === 0 && !schoolId ? (
            <Empty text="暂无团队，请先创建团队" />
          ) : (
            <>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {showSchoolTab && (
                  <button
                    onClick={() => setShowSchool(true)}
                    style={{
                      padding: '0.4rem 0.8rem',
                      borderRadius: 'var(--radius)',
                      border: `1px solid ${showSchool ? 'var(--primary)' : 'var(--border)'}`,
                      background: showSchool ? 'var(--primary-light)' : 'var(--bg-card)',
                      color: showSchool ? 'var(--primary-text)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      fontWeight: showSchool ? 600 : 400,
                    }}
                  >
                    校级比赛
                  </button>
                )}
                {teams.map(t => (
                  <button
                    key={t.id}
                    onClick={() => { setShowSchool(false); setActiveTeamId(t.id) }}
                    style={{
                      padding: '0.4rem 0.8rem',
                      borderRadius: 'var(--radius)',
                      border: `1px solid ${!showSchool && t.id === activeTeamId ? 'var(--primary)' : 'var(--border)'}`,
                      background: !showSchool && t.id === activeTeamId ? 'var(--primary-light)' : 'var(--bg-card)',
                      color: !showSchool && t.id === activeTeamId ? 'var(--primary-text)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      fontWeight: !showSchool && t.id === activeTeamId ? 600 : 400,
                    }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>

              {showSchool && schoolId ? (
                <TeamTrainingList
                  schoolId={schoolId}
                  basePath="/teacher/school"
                  isAdmin={true}
                  mode="contest"
                />
              ) : activeTeamId ? (
                <TeamTrainingList
                  teamId={activeTeamId}
                  basePath="/teacher/teams"
                  isAdmin={true}
                  mode="contest"
                />
              ) : null}
            </>
          )}
        </div>
    </ProtectedRoute>
  )
}
