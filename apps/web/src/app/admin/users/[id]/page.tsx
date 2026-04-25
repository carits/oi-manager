'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import apiClient from '@/lib/apiClient'

interface UserDetail {
  id: string
  username: string
  role: string
  status: string
  phone?: string
  email?: string
  bio?: string
  createdAt: string
  profile?: {
    name: string
    schoolName?: string
    teamName?: string
  }
}

export default function UserDetailPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params.id as string

  const [user, setUser] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchUser()
  }, [userId])

  const fetchUser = async () => {
    try {
      const result = await apiClient.get<UserDetail>(`/api/users/${userId}`)
      if (result.success) {
        setUser(result.data || null)
      } else {
        setError(result.message || '加载失败')
      }
    } catch (e) {
      setError('网络错误')
      console.error('Fetch user error:', e)
    } finally {
      setLoading(false)
    }
  }

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      super_admin: '超级管理员',
      platform_admin: '平台管理员',
      school_principal: '学校负责人',
      teacher: '教师',
      student: '学生'
    }
    return labels[role] || role
  }

  if (loading) {
    return (
      <ProtectedRoute requiredRole="super_admin">
        <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>
          加载中...
        </div>
      </ProtectedRoute>
    )
  }

  if (error || !user) {
    return (
      <ProtectedRoute requiredRole="super_admin">
        <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem' }}>
          <div style={{ padding: '1rem', background: 'var(--error-light)', borderRadius: '6px', color: 'var(--error-text)' }}>
            {error || '用户不存在'}
          </div>
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute requiredRole="super_admin">
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <main style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
          <button
            onClick={() => router.push('/admin/users')}
            style={{
              padding: '0.5rem 1rem',
              background: 'white',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              marginBottom: '1rem'
            }}
          >
            ← 返回
          </button>

          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>用户详情</h2>

          <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>用户名</label>
                <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>{user.username}</p>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>姓名</label>
                <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>{user.profile?.name || '-'}</p>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>角色</label>
                <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>{getRoleLabel(user.role)}</p>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>状态</label>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  background: user.status === 'active' ? 'var(--success-light)' : 'var(--error-light)',
                  color: user.status === 'active' ? 'var(--success-text)' : 'var(--error-text)'
                }}>
                  {user.status === 'active' ? '正常' : '禁用'}
                </span>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>手机号</label>
                <p style={{ fontSize: '0.875rem' }}>{user.phone || '-'}</p>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>邮箱</label>
                <p style={{ fontSize: '0.875rem' }}>{user.email || '-'}</p>
              </div>
              {user.profile?.schoolName && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>学校</label>
                  <p style={{ fontSize: '0.875rem' }}>{user.profile.schoolName}</p>
                </div>
              )}
              {user.profile?.teamName && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>团队</label>
                  <p style={{ fontSize: '0.875rem' }}>{user.profile.teamName}</p>
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>创建时间</label>
                <p style={{ fontSize: '0.875rem' }}>{new Date(user.createdAt).toLocaleString()}</p>
              </div>
            </div>

            {user.bio && (
              <div style={{ marginTop: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>简介</label>
                <p style={{ fontSize: '0.875rem' }}>{user.bio}</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </ProtectedRoute>
  )
}
