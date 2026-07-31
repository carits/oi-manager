'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'
import { AppShell } from './AppShell'
import { getRoleHome } from '@/lib/roleAccess'
import { Loading } from './Loading'
import { LoadError } from './ui/LoadError'

interface RoleLayoutProps {
  children: ReactNode
  allowedRoles: string[]
  loginRole: 'admin' | 'platform-admin' | 'teacher' | 'student'
  homePath: string
  contentClassName?: string
}

export function RoleLayout({
  children,
  allowedRoles,
  loginRole,
  homePath,
  contentClassName,
}: RoleLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading, authError, refreshUser } = useAuth()
  const allowed = Boolean(user && allowedRoles.includes(user.role))

  useEffect(() => {
    if (loading || authError) return
    if (!user) {
      router.replace(`/login?role=${loginRole}`)
      return
    }
    if (!allowed) {
      router.replace(getRoleHome(user.role))
    }
  }, [allowed, authError, loading, loginRole, router, user])

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--gray-50)',
        }}
      >
        <Loading tip="正在验证登录状态..." />
      </div>
    )
  }

  if (authError) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--gray-50)' }}>
        <LoadError message={authError} onRetry={refreshUser} />
      </div>
    )
  }

  if (!user || !allowed) return null
  if (pathname === homePath) return <>{children}</>

  return (
    <AppShell>
      {contentClassName ? (
        <div className={contentClassName}>{children}</div>
      ) : children}
    </AppShell>
  )
}
