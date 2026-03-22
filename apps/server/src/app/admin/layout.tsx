'use client'

import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { AppShell } from '@/components/AppShell'

interface AdminLayoutProps {
  children: ReactNode
}

export default function AdminLayout({ children }: AdminLayoutProps) {
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

  // admin 目录下的页面使用 AppShell
  // 注意：admin/page.tsx (首页) 自己处理 AppShell，避免重复嵌套
  const isAdminHome = pathname === '/admin'

  if (isAdminHome) {
    return <>{children}</>
  }

  return <AppShell>{children}</AppShell>
}
