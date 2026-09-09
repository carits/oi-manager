import type { WorkspaceSummary } from '@oi-manager/shared'

export const personalWorkspaceModules = new Set(['teams', 'problems', 'contests', 'training-sessions', 'problem-lists', 'rankings', 'submissions'])
export const organizationModules = new Set(['overview', 'campus', 'management', 'teams', 'homeworks', 'contests', 'training-sessions', 'problems', 'problem-lists', 'rankings'])

export type NavigationContext = {
  workspace: 'organization' | 'personal' | 'platform'
  platformBasePath?: '/admin' | '/platform-admin'
  organizationId?: string
  role: string
  schoolScoped?: boolean
}
export type ResourceKind = 'team' | 'contest' | 'homework' | 'training' | 'submission'

export function canNavigate(id?: string | number | null) { return id !== undefined && id !== null && String(id).trim() !== '' }
export function fallbackHref(context: NavigationContext) {
  if (context.workspace === 'personal') return '/personal'
  if (context.workspace === 'platform') return context.platformBasePath || '/platform-admin'
  return context.organizationId ? `/org/${context.organizationId}/overview` : '/identity'
}

export function resourceHref(kind: ResourceKind, context: NavigationContext, id?: string | number | null) {
  if (!canNavigate(id)) return null
  const value = String(id)
  if (context.workspace === 'platform') {
    const prefix = context.platformBasePath || '/platform-admin'
    const paths: Partial<Record<ResourceKind, string>> = {
      contest: `${prefix}/contests/${value}`,
      submission: `${prefix}/submissions/${value}`,
    }
    return paths[kind] || null
  }
  if (context.workspace === 'personal') {
    const paths: Partial<Record<ResourceKind, string>> = { team: `/personal/teams/${value}`, contest: `/personal/contests/${value}`, submission: `/personal/submissions/${value}` }
    return paths[kind] || null
  }
  if (!context.organizationId) return null
  const prefix = `/org/${context.organizationId}`
  if (kind === 'team') return `${prefix}/teams/${value}`
  if (kind === 'contest') return `${prefix}/contests/${value}`
  if (kind === 'homework') return `${prefix}/homeworks/${value}`
  if (kind === 'submission') return `${prefix}/submissions/${value}`
  return null
}

export function listHref(kind: 'contest' | 'homework' | 'training', context: NavigationContext) {
  if (context.workspace === 'platform') return kind === 'contest' ? `${context.platformBasePath || '/platform-admin'}/contests` : context.platformBasePath || '/platform-admin'
  if (context.workspace === 'personal') return kind === 'contest' ? '/personal/contests' : '/personal'
  if (!context.organizationId) return '/identity'
  if (kind === 'contest') return `/org/${context.organizationId}/contests`
  if (kind === 'homework') return `/org/${context.organizationId}/homeworks`
  return `/org/${context.organizationId}/teams`
}

export function workspaceModule(pathname: string) {
  const match = pathname.match(/^\/org\/[^/]+\/([^/?#]+)/)
  return match?.[1] || (pathname.startsWith('/personal/') ? pathname.split('/')[2] || 'overview' : 'overview')
}
export function workspaceHref(workspace: WorkspaceSummary, module: string) {
  if (workspace.type === 'platform') return '/platform-admin'
  if (workspace.type === 'personal') return personalWorkspaceModules.has(module) ? `/personal/${module}` : '/personal'
  const target = organizationModules.has(module) && workspace.availableModules.includes(module) ? module : 'overview'
  return `/org/${workspace.organizationId}/${target}`
}
export const moduleHref = workspaceHref

export function notificationTeamHref(workspace: 'organization' | 'personal', organizationId: string | undefined, notificationValue?: string | null) {
  if (!notificationValue) return null
  if (notificationValue.startsWith('organization:')) { const id = notificationValue.slice('organization:'.length); return id ? `/org/${id}/overview` : null }
  if (!notificationValue.startsWith('team:')) return null
  const teamId = notificationValue.slice('team:'.length)
  if (!teamId) return null
  return workspace === 'personal' ? `/personal/teams/${teamId}` : organizationId ? `/org/${organizationId}/teams/${teamId}` : null
}
export const notificationHref = notificationTeamHref
