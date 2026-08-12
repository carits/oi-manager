import type { WorkspaceSummary } from '@oi-manager/shared'

export const personalWorkspaceModules = new Set([
  'teams',
  'problems',
  'contests',
  'problem-lists',
  'rankings',
  'submissions',
])

export const organizationModules = new Set([
  'overview',
  'campus',
  'teachers',
  'students',
  'teams',
  'homeworks',
  'contests',
  'problems',
  'problem-lists',
  'rankings',
])

export type NavigationContext = {
  workspaceMode: 'work' | 'personal'
  role: string
  schoolScoped?: boolean
}

export type ResourceKind = 'team' | 'contest' | 'homework' | 'training' | 'submission'

const prohibitedPaths = new Set([
  '/teacher/school/contests',
  '/student/school/contests',
])

export function canNavigate(id?: string | number | null) {
  return id !== undefined && id !== null && String(id).trim() !== ''
}

export function fallbackHref(context: NavigationContext) {
  if (context.workspaceMode === 'personal') return '/personal'
  return context.role === 'student' ? '/student' : '/teacher'
}

export function resourceHref(kind: ResourceKind, context: NavigationContext, id?: string | number | null) {
  if (!canNavigate(id)) return null
  const value = String(id)
  if (context.workspaceMode === 'personal') {
    const personalPaths: Partial<Record<ResourceKind, string>> = {
      team: `/personal/teams/${value}`,
      contest: `/personal/contests/${value}`,
      submission: `/personal/submissions/${value}`,
    }
    return personalPaths[kind] || null
  }

  const prefix = context.role === 'student' ? '/student' : '/teacher'
  if (kind === 'team') return `${prefix}/${context.role === 'student' ? 'team' : 'teams'}/${value}`
  if (kind === 'contest') return context.schoolScoped ? `${prefix}/school/contests/${value}` : null
  if (kind === 'homework') return context.schoolScoped ? `${prefix}/homeworks/${value}` : null
  if (kind === 'submission') return `${prefix}/submissions/${value}`
  return null
}

export function listHref(kind: 'contest' | 'homework' | 'training', context: NavigationContext) {
  if (context.workspaceMode === 'personal') {
    if (kind === 'contest') return '/personal/contests'
    return '/personal'
  }
  if (kind === 'contest') return context.role === 'student' ? '/student/contests' : '/teacher/contests'
  if (kind === 'homework') return context.role === 'student' ? '/student/homeworks' : '/teacher/homeworks'
  return fallbackHref(context)
}

export function isProhibitedPath(pathname: string) {
  return prohibitedPaths.has(pathname)
}

const moduleByLegacyPath: Array<[string, string]> = [
  ['/teacher/students', 'students'], ['/teacher/teachers', 'teachers'], ['/teacher/teams', 'teams'], ['/teacher/homeworks', 'homeworks'], ['/teacher/contests', 'contests'], ['/teacher/problems', 'problems'], ['/teacher/problem-lists', 'problem-lists'], ['/teacher/rankings', 'rankings'], ['/teacher/school', 'campus'], ['/teacher', 'overview'],
  ['/student/homeworks', 'homeworks'], ['/student/contests', 'contests'], ['/student/team', 'teams'], ['/student/problem-lists', 'problem-lists'], ['/student/rating', 'rankings'], ['/student/school', 'campus'], ['/student', 'overview'],
]

export function workspaceModule(pathname: string) {
  const match = moduleByLegacyPath.find(([path]) => pathname === path || pathname.startsWith(`${path}/`))
  return match?.[1] || 'overview'
}

export function workspaceHref(workspace: WorkspaceSummary, module: string) {
  if (workspace.type === 'personal') {
    return personalWorkspaceModules.has(module) ? `/personal/${module}` : '/personal'
  }
  const target = organizationModules.has(module) && workspace.availableModules.includes(module) ? module : 'overview'
  return `/org/${workspace.organizationId}/${target}`
}

// New navigation must use this name. Keep workspaceHref as a compatibility alias
// while older components are migrated incrementally.
export const moduleHref = workspaceHref

export function notificationTeamHref(
  workspaceMode: 'work' | 'personal',
  role: string,
  notificationHref?: string | null,
) {
  if (!notificationHref) return null
  if (notificationHref.startsWith('organization:')) {
    const organizationId = notificationHref.slice('organization:'.length)
    return organizationId ? `/org/${organizationId}/overview` : null
  }
  if (!notificationHref.startsWith('team:')) return null

  const teamId = notificationHref.slice('team:'.length)
  if (!teamId) return null
  if (workspaceMode === 'personal') return `/personal/teams/${teamId}`
  return role === 'student' ? `/student/team/${teamId}` : `/teacher/teams/${teamId}`
}

export const notificationHref = notificationTeamHref
