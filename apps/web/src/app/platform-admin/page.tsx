'use client'

import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { AppShell } from '@/components/AppShell'
import { useResource } from '@/hooks/useResource'
import { AsyncRegion } from '@/components/ui/AsyncRegion'

interface GlobalStats {
  totalSchools: number
  totalTeachers: number
  totalStudents: number
  activeUsers: number
  disabledUsers: number
  recentRegistrations: number
}

export default function PlatformAdminPage() {
  const { user, sessionKey } = useAuth()
  const stats = useResource<GlobalStats>('/api/stats/global', {
    sessionKey,
    isEmpty: () => false,
    dedupingInterval: 30000,
  })

  return (
    <>
      <AppShell>
        <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>平台管理员控制台</h2>
          <p style={{ color: 'var(--gray-600)', marginBottom: '2rem' }}>欢迎回来，{user?.username}</p>

          {/* 统计卡片 */}
          <AsyncRegion state={stats.state} onRetry={stats.retry} skeletonRows={4}>
            {(data) => (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>学校总数</p>
                <p style={{ fontSize: '2rem', fontWeight: 600 }}>{data.totalSchools}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>教师总数</p>
                <p style={{ fontSize: '2rem', fontWeight: 600 }}>{data.totalTeachers}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>学生总数</p>
                <p style={{ fontSize: '2rem', fontWeight: 600 }}>{data.totalStudents}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>活跃用户</p>
                <p style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--success)' }}>{data.activeUsers}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>禁用用户</p>
                <p style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--error)' }}>{data.disabledUsers}</p>
              </div>
              <div style={{ background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>近30天注册</p>
                <p style={{ fontSize: '2rem', fontWeight: 600 }}>{data.recentRegistrations}</p>
              </div>
            </div>
            )}
          </AsyncRegion>

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
                href="/platform-admin/problems"
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
                <p style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.25rem' }}>题库管理</p>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>管理公共题库</p>
              </Link>
              <Link
                href="/platform-admin/submissions"
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
                <p style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.25rem' }}>评测记录</p>
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>查看平台提交与评测状态</p>
              </Link>
            </div>
          </div>
        </main>
        </div>
      </AppShell>
    </>
  )
}
