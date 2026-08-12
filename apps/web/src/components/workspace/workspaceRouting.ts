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
