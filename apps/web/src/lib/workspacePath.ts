export function isPersonalPath(pathname: string): boolean {
  return pathname === '/personal' || pathname.startsWith('/personal/')
}

export function organizationIdFromPath(pathname: string): string | null {
  return pathname.match(/^\/org\/([^/]+)/)?.[1] || null
}

/** Returns the current context root plus an optional canonical module suffix. */
export function currentWorkspacePrefix(pathname: string, fallback = '/personal', organizationModule = ''): string {
  if (isPersonalPath(pathname)) return fallback
  const organizationId = organizationIdFromPath(pathname)
  if (organizationId) return `/org/${organizationId}${organizationModule}`
  if (pathname.startsWith('/platform-admin/')) return '/platform-admin'
  return fallback
}
