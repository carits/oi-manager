import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { RoleShell } from './RoleShell'
import { SessionUnavailable } from './SessionUnavailable'
import { getServerSession } from '@/lib/serverSession'
import { getRoleHome } from '@/lib/roleAccess'
import { isGlobalAdministrator } from '@/lib/capabilities'
import { ChatProvider } from '@/features/chat'
import { resolveNavigationContext } from '@/lib/navigationContext'
import { authorizationRoleForContext } from '@/lib/serverRequestContext'

interface RoleLayoutProps {
  children: ReactNode
  allowedRoles: string[]
  loginRole: 'admin' | 'platform-admin' | 'teacher' | 'student'
  homePath: string
  contentClassName?: string
  requiredContext?: 'organization' | 'personal' | 'platform'
  organizationId?: string
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
  organizationId,
  roleOverrides = [],
}: RoleLayoutProps) {
  const requestHeaders = await headers()
  const requestedPath = requestHeaders.get('x-oi-request-path') || homePath
  const pathname = requestedPath.split('?')[0]
  const session = await getServerSession(organizationId)

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

  if (session.state === 'context_denied') {
    redirect(`/identity?organizationUnavailable=1&reason=${encodeURIComponent(session.code)}`)
  }

  if (requiredContext === 'organization' && (
    !organizationId
    || session.user.organizationId !== organizationId
    || !session.user.organizationRole
  )) {
    redirect('/identity?organizationUnavailable=1')
  }

  const matchingOverride = [...roleOverrides]
    .sort((left, right) => right.prefix.length - left.prefix.length)
    .find(rule =>
      pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`),
    )
  const effectiveAllowedRoles = matchingOverride?.allowedRoles || allowedRoles

  const authorizationRole = authorizationRoleForContext(session.user, requiredContext)

  if (!authorizationRole || !effectiveAllowedRoles.includes(authorizationRole)) {
    if (isGlobalAdministrator(session.user.accountRole)) {
      redirect(getRoleHome(session.user.accountRole, 'organization'))
    }
    redirect('/identity')
  }

  const context = resolveNavigationContext(pathname, session.user).workspace
  if (requiredContext && context !== requiredContext) redirect('/identity')

  return (
    <ChatProvider>
      <RoleShell homePath={homePath} contentClassName={contentClassName}>
        {children}
      </RoleShell>
    </ChatProvider>
  )
}
