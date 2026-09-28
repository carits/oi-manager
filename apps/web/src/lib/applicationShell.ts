/** Route and scope facts shared by the persistent shell and its tests. */
export function isApplicationPath(pathname: string): boolean {
  return /^\/(?:personal|org|account|admin|platform-admin)(?:\/|$)/.test(pathname)
}
export function organizationFromPath(pathname: string): string | undefined {
  const segment = pathname.split('?')[0].match(/^\/org\/([^/]+)(?:\/|$)/)?.[1]
  if (!segment) return undefined
  try { return decodeURIComponent(segment) } catch { return undefined }
}
/** Ignore access failures from requests that belong to a workspace the user has already left. */
export function organizationUnavailableAffectsPath(pathname: string, requestOrganizationId?: string): boolean {
  const activeOrganizationId = organizationFromPath(pathname)
  return Boolean(activeOrganizationId && (!requestOrganizationId || requestOrganizationId === activeOrganizationId))
}
export function accountContextMatches(pathname: string, user: { organizationId?: string | null; organizationRole?: string | null } | null | undefined): boolean {
  if (!user) return false
  const organizationId = organizationFromPath(pathname)
  return organizationId ? user.organizationId === organizationId && Boolean(user.organizationRole) : !user.organizationId && !user.organizationRole
}
export type PageLayout = 'default' | 'reading' | 'form' | 'workbench'
/** The shell, not individual feature components, owns authenticated page widths. */
export function pageLayoutForPath(pathname: string): PageLayout {
  const path = pathname.split('?')[0]
  if (/\/(?:new|create|edit)$/.test(path) || /^\/account\/(?:profile|security|platform-bindings)$/.test(path)) return 'form'
  if (/\/(?:training-sessions|submissions|problems)\/[^/]+(?:\/design)?$/.test(path)) return 'workbench'
  if (/\/(?:knowledge|blogs)\/[^/]+$/.test(path)) return 'reading'
  return 'default'
}
