'use client'

import { ReactNode, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { AppShell } from '@/components/AppShell'

interface StudentLayoutProps {
  children: ReactNode
}

export default function StudentLayout({ children }: StudentLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()

  // loading=false 且 user=null 时跳转登录页
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?role=student')
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

  // student 目录下的页面使用 AppShell
  // 注意：student/page.tsx (首页) 自己处理 AppShell，避免重复嵌套
  const isStudentHome = pathname === '/student'

  if (isStudentHome) {
    return <>{children}</>
  }

  return <AppShell>{children}</AppShell>
}
