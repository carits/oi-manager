'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider'
import { AppShell } from './AppShell'
import { getRoleHome } from '@/lib/roleAccess'

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
  const { user, loading } = useAuth()
  const allowed = Boolean(user && allowedRoles.includes(user.role))

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace(`/login?role=${loginRole}`)
      return
    }
    if (!allowed) {
      router.replace(getRoleHome(user.role))
    }
  }, [allowed, loading, loginRole, router, user])

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
        加载中...
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
