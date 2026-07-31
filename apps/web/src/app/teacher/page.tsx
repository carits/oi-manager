'use client'

import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { AppShell } from '@/components/AppShell'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'

// 教师/学校负责人首页
export default function TeacherPage() {
  const { user } = useAuth()

  const isSchoolPrincipal = user?.role === 'school_principal'

  return (
    <>
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
              <Link href="/teacher/students" style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.875rem', textDecoration: 'none' }}>
                查看学生
              </Link>
              <Link href="/teacher/teams" style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.875rem', textDecoration: 'none' }}>
                管理团队
              </Link>
              {isSchoolPrincipal && (
                <Link href="/teacher/school" style={{ display: 'block', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius)', color: 'var(--text-primary)', fontSize: '0.875rem', textDecoration: 'none' }}>
                  进入我的学校
                </Link>
              )}
            </div>
          </Card>

          {/* 右侧：我的信息 */}
          <Card title="我的信息">
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              <p><strong>用户名：</strong>{user?.username}</p>
              <p><strong>角色：</strong>{isSchoolPrincipal ? '学校负责人' : '教师'}</p>
              {user?.schoolName && <p><strong>所属学校：</strong>{user.schoolName}</p>}
            </div>
          </Card>
        </div>
      </AppShell>
    </>
  )
}
