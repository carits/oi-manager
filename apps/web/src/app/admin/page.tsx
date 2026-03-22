'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppShell, PageHeader, Card } from '@/components/AppShell'

// 超管首页 - 平台级概览
export default function AdminPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <ProtectedRoute requiredRole="super_admin">
        <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>
          加载中...
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute requiredRole="super_admin">
      <AppShell>
        <PageHeader title="超级管理员控制台" description={`欢迎回来，${user?.username}`} />

        {/* 超管首页布局 */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
          {/* 左侧：最近学校变更 */}
          <Card title="最近学校变更">
            <div style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>
              <p>暂无学校变更记录</p>
            </div>
          </Card>

          {/* 右侧两块 */}
          <div style={{ display: 'grid', gap: '1.5rem' }}>
            {/* 快捷操作 */}
            <Card title="快捷操作">
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <a href="/admin/schools" style={{ display: 'block', padding: '0.75rem', background: 'var(--gray-50)', borderRadius: '6px', color: 'var(--gray-700)', fontSize: '0.875rem', textDecoration: 'none' }}>
                  + 创建学校
                </a>
                <a href="/admin/schools" style={{ display: 'block', padding: '0.75rem', background: 'var(--gray-50)', borderRadius: '6px', color: 'var(--gray-700)', fontSize: '0.875rem', textDecoration: 'none' }}>
                  查看学校列表
                </a>
              </div>
            </Card>

            {/* 我的信息 */}
            <Card title="我的信息">
              <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                <p><strong>用户名：</strong>{user?.username}</p>
                <p><strong>角色：</strong>超级管理员</p>
              </div>
            </Card>
          </div>
        </div>
      </AppShell>
    </ProtectedRoute>
  )
}
