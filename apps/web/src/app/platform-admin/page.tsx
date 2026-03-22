'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppShell } from '@/components/AppShell'

interface GlobalStats {
  totalSchools: number
  totalTeachers: number
  totalStudents: number
  totalContests: number
  totalPublicContests: number
  activeUsers: number
  disabledUsers: number
  recentRegistrations: number
}

export default function PlatformAdminPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('http://localhost:3001/api/stats/global', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (data.success) {
        setStats(data.data)
      }
    } catch (e) {
      console.error('Fetch stats error:', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ProtectedRoute requiredRole="platform_admin">
      <AppShell>
        <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>平台管理员控制台</h2>
          <p style={{ color: 'var(--gray-600)', marginBottom: '2rem' }}>欢迎回来，{user?.username}</p>

          {/* 统计卡片 */}
          {loading ? (
            <p>加载中...</p>
          ) : stats ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>学校总数</p>
                <p style={{ fontSize: '2rem', fontWeight: 600 }}>{stats.totalSchools}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>教师总数</p>
                <p style={{ fontSize: '2rem', fontWeight: 600 }}>{stats.totalTeachers}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>学生总数</p>
                <p style={{ fontSize: '2rem', fontWeight: 600 }}>{stats.totalStudents}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>比赛总数</p>
                <p style={{ fontSize: '2rem', fontWeight: 600 }}>{stats.totalContests}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>公共比赛</p>
                <p style={{ fontSize: '2rem', fontWeight: 600 }}>{stats.totalPublicContests}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>活跃用户</p>
                <p style={{ fontSize: '2rem', fontWeight: 600, color: '#16a34a' }}>{stats.activeUsers}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>禁用用户</p>
                <p style={{ fontSize: '2rem', fontWeight: 600, color: '#dc2626' }}>{stats.disabledUsers}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>近30天注册</p>
                <p style={{ fontSize: '2rem', fontWeight: 600 }}>{stats.recentRegistrations}</p>
              </div>
            </div>
          ) : null}

          {/* 快捷操作 */}
          <div style={{ background: 'white', padding: '2rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>快捷操作</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              <Link
                href="/platform-admin/users"
                style={{
                  display: 'block',
                  padding: '1.5rem',
                  background: 'var(--gray-50)',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  color: 'var(--gray-900)',
                  border: '1px solid var(--border)'
                }}
              >
                <p style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.25rem' }}>账号管理</p>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>管理所有用户账号</p>
              </Link>
              <Link
                href="/platform-admin/contests"
                style={{
                  display: 'block',
                  padding: '1.5rem',
                  background: 'var(--gray-50)',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  color: 'var(--gray-900)',
                  border: '1px solid var(--border)'
                }}
              >
                <p style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.25rem' }}>公共比赛</p>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>管理公共比赛</p>
              </Link>
              <Link
                href="/platform-admin/stats"
                style={{
                  display: 'block',
                  padding: '1.5rem',
                  background: 'var(--gray-50)',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  color: 'var(--gray-900)',
                  border: '1px solid var(--border)'
                }}
              >
                <p style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.25rem' }}>统计数据</p>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>查看全局统计</p>
              </Link>
            </div>
          </div>
        </main>
        </div>
      </AppShell>
    </ProtectedRoute>
  )
}
