'use client'

import { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'

interface ProtectedRouteProps {
  children: ReactNode
  requiredRole?: string | string[]
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, loading, isAuthenticated, sessionKey } = useAuth()
  const router = useRouter()

  // 权限检查
  const hasAccess = !requiredRole ||
    (Array.isArray(requiredRole)
      ? requiredRole.includes(user?.role || '')
      : user?.role === requiredRole ||
        (requiredRole === 'super_admin' && user?.role === 'platform_admin') ||
        (requiredRole === 'teacher' && user?.role === 'school_principal'))

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
    if (typeof window !== 'undefined') {
      router.push('/login')
    }
    return null
  }

  if (!hasAccess) {
    // 角色不匹配，跳转到对应角色的首页
    if (typeof window !== 'undefined') {
      router.push(`/${user?.role}`)
    }
    return null
  }

  // 使用 sessionKey 作为 key，确保账号切换时组件重新挂载
  return <div key={sessionKey}>{children}</div>
}