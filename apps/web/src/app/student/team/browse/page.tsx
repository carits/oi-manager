'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { getAssetUrl } from '@/lib/assets'

interface Team {
  id: string
  name: string
  avatar?: string | null
  description?: string | null
  owner: { id: string; name: string }
  school: { id: string; name: string }
  _count?: { members: number }
  memberStatus?: string | null
  requestStatus?: string | null
}

// 学生端 - 浏览团队页面
export default function StudentTeamBrowsePage() {
  const { user } = useAuth()
  const router = useRouter()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (user?.schoolId && mounted) {
      fetchTeams()
    }
  }, [user?.schoolId, mounted])

  const fetchTeams = async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<Team[]>(`/api/teams/school/${user?.schoolId}`)
      if (result.success) {
        setTeams(result.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch teams:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleApplyJoin = async (teamId: string) => {
    try {
      const result = await apiClient.post(`/api/teams/${teamId}/join-request`, {
        message: '我想加入这个团队'
      })
      if (result.success) {
        alert('申请已提交')
        fetchTeams()
      } else {
        alert(result.message || '申请失败')
      }
    } catch (error) {
      console.error('Apply join error:', error)
      alert('申请失败')
    }
  }

  const filteredTeams = teams.filter(team =>
    team.name.toLowerCase().includes(searchKeyword.toLowerCase()) ||
    team.description?.toLowerCase().includes(searchKeyword.toLowerCase())
  )

  // 按状态分组
  const joinedTeams = filteredTeams.filter(t => t.memberStatus === 'active')
  const pendingTeams = filteredTeams.filter(t => t.requestStatus === 'pending')
  const availableTeams = filteredTeams.filter(t => !t.memberStatus && !t.requestStatus)

  if (!mounted || loading) {
    return (
      <ProtectedRoute requiredRole="student">
        <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>
          加载中...
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute requiredRole="student">
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>浏览团队</h2>
          <button
            onClick={() => router.push('/student/team')}
            style={{
              padding: '0.5rem 1rem',
              background: 'white',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            ← 返回我的团队
          </button>
        </div>

        {/* 搜索框 */}
        <div style={{ marginBottom: '1.5rem' }}>
          <input
            type="text"
            placeholder="搜索团队..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            style={{
              width: '100%',
              maxWidth: '400px',
              padding: '0.75rem 1rem',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '0.875rem'
            }}
          />
        </div>

        {/* 已加入的团队 */}
        {joinedTeams.length > 0 && (
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--gray-700)' }}>
              已加入 ({joinedTeams.length})
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {joinedTeams.map(team => (
                <div
                  key={team.id}
                  style={{
                    background: 'white',
                    borderRadius: '8px',
                    padding: '1.5rem',
                    border: '1px solid var(--border)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                    <div
                      style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '8px',
                        background: team.avatar
                          ? `url(${getAssetUrl(team.avatar)}) center/cover`
                          : 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: 600,
                        fontSize: '1.25rem'
                      }}
                    >
                      {!team.avatar && team.name.charAt(0)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ fontWeight: 600 }}>{team.name}</h4>
                      <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>
                        {team._count?.members || 0} 人
                      </p>
                    </div>
                  </div>
                  {team.description && (
                    <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '1rem' }}>
                      {team.description}
                    </p>
                  )}
                  <button
                    onClick={() => router.push(`/student/team/${team.id}`)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: 'var(--primary)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    查看详情
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 待审批 */}
        {pendingTeams.length > 0 && (
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--gray-700)' }}>
              待审批 ({pendingTeams.length})
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {pendingTeams.map(team => (
                <div
                  key={team.id}
                  style={{
                    background: 'white',
                    borderRadius: '8px',
                    padding: '1.5rem',
                    border: '1px solid var(--border)',
                    opacity: 0.8
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                    <div
                      style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '8px',
                        background: team.avatar
                          ? `url(${getAssetUrl(team.avatar)}) center/cover`
                          : 'var(--gray-200)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--gray-600)',
                        fontWeight: 600,
                        fontSize: '1.25rem'
                      }}
                    >
                      {!team.avatar && team.name.charAt(0)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ fontWeight: 600 }}>{team.name}</h4>
                      <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>
                        {team._count?.members || 0} 人
                      </p>
                    </div>
                  </div>
                  {team.description && (
                    <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '1rem' }}>
                      {team.description}
                    </p>
                  )}
                  <button
                    disabled
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: 'var(--gray-200)',
                      color: 'var(--gray-500)',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'not-allowed'
                    }}
                  >
                    等待审批中...
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 可申请 */}
        <div>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--gray-700)' }}>
            可申请 ({availableTeams.length})
          </h3>
          {availableTeams.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
              {availableTeams.map(team => (
                <div
                  key={team.id}
                  style={{
                    background: 'white',
                    borderRadius: '8px',
                    padding: '1.5rem',
                    border: '1px solid var(--border)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                    <div
                      style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '8px',
                        background: team.avatar
                          ? `url(${getAssetUrl(team.avatar)}) center/cover`
                          : 'var(--gray-200)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--gray-600)',
                        fontWeight: 600,
                        fontSize: '1.25rem'
                      }}
                    >
                      {!team.avatar && team.name.charAt(0)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ fontWeight: 600 }}>{team.name}</h4>
                      <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>
                        {team._count?.members || 0} 人 · {team.owner.name}
                      </p>
                    </div>
                  </div>
                  {team.description && (
                    <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '1rem' }}>
                      {team.description}
                    </p>
                  )}
                  <button
                    onClick={() => handleApplyJoin(team.id)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      background: 'var(--primary)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                  >
                    申请加入
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: '8px', padding: '2rem', border: '1px solid var(--border)', textAlign: 'center' }}>
              <p style={{ color: 'var(--gray-500)' }}>
                {searchKeyword ? '没有找到匹配的团队' : '暂无可申请的团队'}
              </p>
            </div>
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}
