'use client'

import { ReactNode, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'
import { getRoleHome, roleHasAccess } from '@/lib/roleAccess'
import { Loading } from './Loading'
import { LoadError } from './ui/LoadError'

interface ProtectedRouteProps {
  children: ReactNode
  requiredRole?: string | string[]
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, loading, authError, refreshUser, isAuthenticated, sessionKey } = useAuth()
  const router = useRouter()

  // 权限检查
  const hasAccess = roleHasAccess(user?.role, requiredRole)

  useEffect(() => {
    if (loading || authError) return
    if (!isAuthenticated) {
      router.replace('/login')
      return
    }
    if (!hasAccess) {
      router.replace(getRoleHome(user?.role))
    }
  }, [authError, hasAccess, isAuthenticated, loading, router, user?.role])

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Loading tip="正在验证登录状态..." />
      </div>
    )
  }

  if (authError) {
    return <LoadError message={authError} onRetry={refreshUser} />
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
