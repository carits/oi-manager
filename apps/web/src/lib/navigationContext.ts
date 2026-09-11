import { isGlobalAdministrator } from './capabilities'

export type NavigationWorkspace = 'organization' | 'personal' | 'platform'

export type NavigationContext = {
  workspace: NavigationWorkspace
  role: string
  basePath?: string
  homeHref?: string
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
    const platformBasePath = role === 'super_admin' ? '/admin' : '/platform-admin'
    return {
      workspace: 'platform',
      role,
      basePath: platformBasePath,
      homeHref: platformBasePath,
      platformBasePath,
    }
  }

  const organizationId = pathname.match(/^\/org\/([^/]+)/)?.[1]
  if (organizationId) {
    return {
      workspace: 'organization',
      role: user?.organizationRole || role,
      organizationId,
      basePath: `/org/${encodeURIComponent(organizationId)}`,
      homeHref: `/org/${encodeURIComponent(organizationId)}/overview`,
    }
  }

  return { workspace: 'personal', role, basePath: '/personal', homeHref: '/personal' }
}

export function knowledgeHref(context: NavigationContext): string {
  if (context.workspace === 'organization' && context.organizationId) {
    return `/org/${encodeURIComponent(context.organizationId)}/knowledge`
  }
  if (context.workspace === 'platform') return `${context.platformBasePath || '/platform-admin'}/knowledge`
  return '/personal/knowledge'
}

export function navigationHome(context: NavigationContext): string {
  if (context.homeHref) return context.homeHref
  if (context.workspace === 'organization' && context.organizationId) return `/org/${encodeURIComponent(context.organizationId)}/overview`
  if (context.workspace === 'platform') return context.platformBasePath || '/platform-admin'
  return '/personal'
}
