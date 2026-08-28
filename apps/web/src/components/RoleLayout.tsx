import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AuthProvider } from './AuthProvider'
import { RoleShell } from './RoleShell'
import { SessionUnavailable } from './SessionUnavailable'
import { getServerSession } from '@/lib/serverSession'
import { getRoleHome } from '@/lib/roleAccess'
import { isGlobalAdministrator } from '@/lib/capabilities'

interface RoleLayoutProps {
  children: ReactNode
  allowedRoles: string[]
  loginRole: 'admin' | 'platform-admin' | 'teacher' | 'student'
  homePath: string
  contentClassName?: string
  requiredContext?: 'organization' | 'personal' | 'platform'
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
  requiredContext,
  roleOverrides = [],
}: RoleLayoutProps) {
  const requestHeaders = await headers()
  const requestedPath = requestHeaders.get('x-oi-request-path') || homePath
  const pathname = requestedPath.split('?')[0]
  const session = await getServerSession()

  if (session.state === 'anonymous') {
    redirect(`/login?next=${encodeURIComponent(requestedPath)}`)
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
    if (isGlobalAdministrator(session.user.role)) {
      redirect(getRoleHome(session.user.role, 'organization'))
    }
    redirect('/identity')
  }

  const context = pathname === '/personal' || pathname.startsWith('/personal/') ? 'personal' : pathname.startsWith('/platform-admin') || pathname.startsWith('/admin') ? 'platform' : 'organization'
  if (requiredContext && context !== requiredContext) redirect('/identity')

  return (
    <AuthProvider initialUser={session.user}>
      <RoleShell homePath={homePath} contentClassName={contentClassName}>
        {children}
      </RoleShell>
    </AuthProvider>
  )
}
