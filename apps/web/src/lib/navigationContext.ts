import { isGlobalAdministrator } from './capabilities'

export type NavigationWorkspace = 'organization' | 'personal' | 'platform'

export type NavigationContext = {
  workspace: NavigationWorkspace
  role: string
  organizationId?: string
  platformBasePath?: '/admin' | '/platform-admin'
}

type NavigationUser = {
  role?: string | null
  organizationId?: string | null
  organizationRole?: string | null
}

export function resolveNavigationContext(pathname: string, user?: NavigationUser | null): NavigationContext {
  const role = user?.role || 'user'
  if (isGlobalAdministrator(role)) {
    return {
      workspace: 'platform',
      role,
      platformBasePath: role === 'super_admin' ? '/admin' : '/platform-admin',
    }
  }

  const organizationId = pathname.match(/^\/org\/([^/]+)/)?.[1]
  if (organizationId) {
    return {
      workspace: 'organization',
      role: user?.organizationRole || role,
      organizationId,
    }
  }

  return { workspace: 'personal', role }
}

export function knowledgeHref(context: NavigationContext): string {
  if (context.workspace === 'organization' && context.organizationId) {
    return `/org/${encodeURIComponent(context.organizationId)}/knowledge`
  }
  if (context.workspace === 'platform') return `${context.platformBasePath || '/platform-admin'}/knowledge`
  return '/personal/knowledge'
}

export function navigationHome(context: NavigationContext): string {
  if (context.workspace === 'organization' && context.organizationId) {
    return `/org/${encodeURIComponent(context.organizationId)}/overview`
  }
  if (context.workspace === 'platform') return context.platformBasePath || '/platform-admin'
  return '/personal'
}
