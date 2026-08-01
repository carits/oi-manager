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
  requiredWorkspace?: 'work' | 'personal'
  roleOverrides?: Array<{
    prefix: string
    allowedRoles: string[]
  }>
}

function mapLegacyPersonalPath(requestedPath: string): string {
  const [pathname, query = ''] = requestedPath.split('?')
  const withQuery = (target: string) => query ? `${target}?${query}` : target

  if (pathname === '/student/team/browse') return withQuery('/personal/teams')
  if (pathname === '/student/problems/new') return withQuery('/personal/problems')

  const legacyProblemTool = pathname.match(/^\/student\/problems\/([^/]+)\/(edit|note)$/)
  if (legacyProblemTool) return withQuery(`/personal/problems/${legacyProblemTool[1]}`)

  const mappings: Array<[string, string]> = [
    ['/student/platform-bindings', '/account/platform-bindings'],
    ['/student/problem-lists', '/personal/problem-lists'],
    ['/student/submissions', '/personal/submissions'],
    ['/student/problems', '/personal/problems'],
    ['/student/contests', '/personal/contests'],
    ['/student/rating', '/personal/rankings'],
    ['/student/security', '/account/security'],
    ['/student/profile', '/account/profile'],
    ['/student/team', '/personal/teams'],
  ]
  const match = mappings.find(([source]) => pathname === source || pathname.startsWith(`${source}/`))
  if (!match) return '/personal'
  const target = `${match[1]}${pathname.slice(match[0].length)}`
  return withQuery(target)
}

export async function RoleLayout({
  children,
  allowedRoles,
  loginRole,
  homePath,
  contentClassName,
  requiredWorkspace,
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
    redirect(getRoleHome(session.user.role, session.user.workspaceMode || 'work'))
  }

  const workspaceMode = session.user.workspaceMode
    || (session.user.studentMode === 'personal' ? 'personal' : 'work')
  if (requiredWorkspace && workspaceMode !== requiredWorkspace) {
    if (workspaceMode === 'personal' && pathname.startsWith('/student')) {
      redirect(mapLegacyPersonalPath(requestedPath))
    }
    redirect(getRoleHome(session.user.role, workspaceMode))
  }

  return (
    <AuthProvider initialUser={session.user}>
      <RoleShell homePath={homePath} contentClassName={contentClassName}>
        {children}
      </RoleShell>
    </AuthProvider>
  )
}
