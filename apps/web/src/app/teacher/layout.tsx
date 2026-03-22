'use client'

import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { AppShell } from '@/components/AppShell'

interface TeacherLayoutProps {
  children: ReactNode
}

export default function TeacherLayout({ children }: TeacherLayoutProps) {
  const pathname = usePathname()
  const { user, loading } = useAuth()

  // 等待用户加载完成
  if (loading || !user) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--gray-50)'
      }}>
        加载中...
      </div>
    )
  }

  // teacher 目录下所有页面都使用 AppShell
  // 首页自己处理 AppShell，避免重复嵌套
  const isTeacherHome = pathname === '/teacher'

  if (isTeacherHome) {
    return <>{children}</>
  }

  // 对所有子页面，用 AppShell 统一包裹
  return (
    <AppShell>
      <div className="teacher-page-content">
        {children}
      </div>
    </AppShell>
  )
}
