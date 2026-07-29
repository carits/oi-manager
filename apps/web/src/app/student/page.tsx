'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'

// 学生首页
export default function StudentPage() {
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <ProtectedRoute requiredRole="student">
        <div style={{ minHeight: '100vh', background: 'var(--bg-page)', padding: '2rem', textAlign: 'center' }}>
          加载中...
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute requiredRole="student">
      <AppShell>
        <PageHeader title="学生首页" description={`欢迎回来，${user?.username}`} />

        {/* 首页布局 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          {/* 左侧：快捷操作 */}
          <Card title="快捷操作">
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {user?.studentMode === 'personal' ? (
                <>
                  <Link href="/student/problems" style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.875rem', textDecoration: 'none' }}>
                    浏览题库
                  </Link>
                  <Link href="/student/team" style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.875rem', textDecoration: 'none' }}>
                    我的团队
                  </Link>
                  <Link href="/student/submissions" style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.875rem', textDecoration: 'none' }}>
                    评测记录
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/student/team" style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.875rem', textDecoration: 'none' }}>
                    进入我的团队
                  </Link>
                  <Link href="/student/rating" style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.875rem', textDecoration: 'none' }}>
                    查看我的成长
                  </Link>
                  <Link href="/student/homeworks" style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.875rem', textDecoration: 'none' }}>
                    我的作业
                  </Link>
                </>
              )}
            </div>
          </Card>

          {/* 右侧：我的信息 */}
          <Card title="我的信息">
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              <p><strong>用户名：</strong>{user?.username}</p>
              <p><strong>角色：</strong>学生</p>
            </div>
          </Card>
        </div>
      </AppShell>
    </ProtectedRoute>
  )
}
