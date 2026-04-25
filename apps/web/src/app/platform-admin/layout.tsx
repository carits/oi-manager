'use client'

import { ReactNode, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { AppShell } from '@/components/AppShell'

interface PlatformAdminLayoutProps {
  children: ReactNode
}

export default function PlatformAdminLayout({ children }: PlatformAdminLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()

  // loading=false 且 user=null 时跳转登录页
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?role=platform-admin')
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

  // 首页特殊处理：首页自己包含 AppShell，避免重复嵌套
  const isPlatformAdminHome = pathname === '/platform-admin'

  if (isPlatformAdminHome) {
    return <>{children}</>
  }

  // 其他页面用 AppShell 包裹，显示导航
  return <AppShell>{children}</AppShell>
}
