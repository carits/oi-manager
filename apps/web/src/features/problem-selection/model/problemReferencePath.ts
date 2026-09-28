import { currentWorkspacePrefix } from '@/lib/workspacePath'

/** The active URL, not the account's global role, owns the problem reference. */
export function problemReferenceHref(pathname: string, internalProblemId: string): string {
  const workspace = currentWorkspacePrefix(pathname)
  // Super-admin pages have no /admin/problems detail route.
  const prefix = workspace === '/admin' ? '/platform-admin' : workspace
  return `${prefix}/problems/${encodeURIComponent(internalProblemId)}?returnTo=${encodeURIComponent(pathname)}`
}
