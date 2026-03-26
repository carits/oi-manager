'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppShell, PageHeader, Card } from '@/components/AppShell'

// 教师/学校负责人首页
export default function TeacherPage() {
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <ProtectedRoute requiredRole="teacher">
        <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>
          加载中...
        </div>
      </ProtectedRoute>
    )
  }

  const isSchoolPrincipal = user?.role === 'school_principal'

  return (
    <ProtectedRoute requiredRole="teacher">
      <AppShell>
        <PageHeader
          title={isSchoolPrincipal ? '学校负责人控制台' : '教师控制台'}
          description={`欢迎回来，${user?.username}`}
        />

        {/* 首页布局 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          {/* 左侧：快捷操作 */}
          <Card title="快捷操作">
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <Link href="/teacher/students" style={{ display: 'block', padding: '0.75rem', background: 'var(--gray-50)', borderRadius: '6px', color: 'var(--gray-700)', fontSize: '0.875rem', textDecoration: 'none' }}>
                查看学生
              </Link>
              <Link href="/teacher/teams" style={{ display: 'block', padding: '0.75rem', background: 'var(--gray-50)', borderRadius: '6px', color: 'var(--gray-700)', fontSize: '0.875rem', textDecoration: 'none' }}>
                管理团队
              </Link>
              {isSchoolPrincipal && (
                <Link href="/teacher/school" style={{ display: 'block', padding: '0.75rem', background: 'var(--gray-50)', borderRadius: '6px', color: 'var(--gray-700)', fontSize: '0.875rem', textDecoration: 'none' }}>
                  进入我的学校
                </Link>
              )}
            </div>
          </Card>

          {/* 右侧：我的信息 */}
          <Card title="我的信息">
            <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>
              <p><strong>用户名：</strong>{user?.username}</p>
              <p><strong>角色：</strong>{isSchoolPrincipal ? '学校负责人' : '教师'}</p>
              {user?.schoolName && <p><strong>所属学校：</strong>{user.schoolName}</p>}
            </div>
          </Card>
        </div>
      </AppShell>
    </ProtectedRoute>
  )
}
