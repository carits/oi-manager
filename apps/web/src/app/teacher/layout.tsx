'use client'

import { ReactNode, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { AppShell } from '@/components/AppShell'

interface TeacherLayoutProps {
  children: ReactNode
}

export default function TeacherLayout({ children }: TeacherLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()

  // loading=false 且 user=null 时跳转登录页
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?role=teacher')
    }
  }, [loading, user, router])

  // loading=true 时显示加载中
  if (loading) {
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

  // loading=false 且 user=null 时返回 null（等待跳转）
  if (!user) {
    return null
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
