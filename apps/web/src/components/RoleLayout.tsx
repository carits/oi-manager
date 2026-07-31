import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthProvider } from './AuthProvider'
import { RoleShell } from './RoleShell'
import { SessionUnavailable } from './SessionUnavailable'
import { getRoleHome } from '@/lib/roleAccess'
import { getServerSession } from '@/lib/serverSession'

interface RoleLayoutProps {
  children: ReactNode
  allowedRoles: string[]
  loginRole: 'admin' | 'platform-admin' | 'teacher' | 'student'
  homePath: string
  contentClassName?: string
  roleOverrides?: Array<{
    prefix: string
    allowedRoles: string[]
  }>
}

export async function RoleLayout({
  children,
  allowedRoles,
  loginRole,
  homePath,
  contentClassName,
  roleOverrides = [],
}: RoleLayoutProps) {
  const requestedPath = headers().get('x-oi-request-path') || homePath
  const pathname = requestedPath.split('?')[0]
  const session = await getServerSession()

  if (session.state === 'anonymous') {
    redirect(`/login?role=${loginRole}&next=${encodeURIComponent(requestedPath)}`)
  }

  if (session.state === 'unavailable') {
    return (
      <SessionUnavailable
        message={session.message}
        requestId={session.requestId}
      />
    )
  }

  const matchingOverride = [...roleOverrides]
    .sort((left, right) => right.prefix.length - left.prefix.length)
    .find(rule =>
      pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`),
    )
  const effectiveAllowedRoles = matchingOverride?.allowedRoles || allowedRoles

  if (!effectiveAllowedRoles.includes(session.user.role)) {
    redirect(getRoleHome(session.user.role))
  }

  return (
    <AuthProvider initialUser={session.user}>
      <RoleShell homePath={homePath} contentClassName={contentClassName}>
        {children}
      </RoleShell>
    </AuthProvider>
  )
}
