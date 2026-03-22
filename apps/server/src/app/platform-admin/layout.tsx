'use client'

import { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { AppShell } from '@/components/AppShell'

interface PlatformAdminLayoutProps {
  children: ReactNode
}

export default function PlatformAdminLayout({ children }: PlatformAdminLayoutProps) {
  const pathname = usePathname()
  const { user, loading } = useAuth()

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

  // 首页特殊处理：首页自己包含 AppShell，避免重复嵌套
  const isPlatformAdminHome = pathname === '/platform-admin'

  if (isPlatformAdminHome) {
    return <>{children}</>
  }

  // 其他页面用 AppShell 包裹，显示导航
  return <AppShell>{children}</AppShell>
}
