'use client'

import { ReactNode, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'
import { getRoleHome, roleHasAccess } from '@/lib/roleAccess'

interface ProtectedRouteProps {
  children: ReactNode
  requiredRole?: string | string[]
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, loading, isAuthenticated, sessionKey } = useAuth()
  const router = useRouter()

  // 权限检查
  const hasAccess = roleHasAccess(user?.role, requiredRole)

  useEffect(() => {
    if (loading) return
    if (!isAuthenticated) {
      router.replace('/login')
      return
    }
    if (!hasAccess) {
      router.replace(getRoleHome(user?.role))
    }
  }, [hasAccess, isAuthenticated, loading, router, user?.role])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <p>加载中...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  if (!hasAccess) {
    return null
  }

  // 使用 sessionKey 作为 key，确保账号切换时组件重新挂载
  return <div key={sessionKey}>{children}</div>
}
