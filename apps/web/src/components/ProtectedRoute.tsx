'use client'

import { useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'

interface ProtectedRouteProps {
  children: ReactNode
  requiredRole?: string | string[]
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, loading, isAuthenticated } = useAuth()
  const router = useRouter()

  // 权限检查
  const hasAccess = !requiredRole ||
    (Array.isArray(requiredRole)
      ? requiredRole.includes(user?.role || '')
      : user?.role === requiredRole ||
        (requiredRole === 'super_admin' && user?.role === 'platform_admin') ||
        (requiredRole === 'teacher' && user?.role === 'school_principal'))

  useEffect(() => {
    if (!loading && !hasAccess) {
      if (!isAuthenticated) {
        router.push('/login')
        return
      }

      // 角色不匹配，跳转到对应角色的首页
      router.push(`/${user?.role}`)
    }
  }, [loading, isAuthenticated, user, requiredRole, router, hasAccess])

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

  return <>{children}</>
}
