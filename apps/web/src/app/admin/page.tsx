'use client'

import { useAuth } from '@/components/AuthProvider'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'

// 超管首页 - 平台级概览
export default function AdminPage() {
  const { user } = useAuth()

  return (
    <>
      <AppShell>
        <PageHeader title="超级管理员控制台" description={`欢迎回来，${user?.username}`} />

        {/* 超管首页布局 */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
          {/* 左侧：最近学校变更 */}
          <Card title="最近学校变更">
            <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              <p>暂无学校变更记录</p>
            </div>
          </Card>

          {/* 右侧两块 */}
          <div style={{ display: 'grid', gap: '1.5rem' }}>
            {/* 快捷操作 */}
            <Card title="快捷操作">
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <a href="/admin/schools" style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.875rem', textDecoration: 'none' }}>
                  + 创建学校
                </a>
                <a href="/admin/schools" style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.875rem', textDecoration: 'none' }}>
                  查看学校列表
                </a>
              </div>
            </Card>

            {/* 我的信息 */}
            <Card title="我的信息">
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                <p><strong>用户名：</strong>{user?.username}</p>
                <p><strong>角色：</strong>超级管理员</p>
              </div>
            </Card>
          </div>
        </div>
      </AppShell>
    </>
  )
}
