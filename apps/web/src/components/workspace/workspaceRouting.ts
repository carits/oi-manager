import type { WorkspaceSummary } from '@oi-manager/shared'

const moduleByLegacyPath: Array<[string, string]> = [
  ['/teacher/students', 'students'], ['/teacher/teachers', 'teachers'], ['/teacher/teams', 'teams'], ['/teacher/homeworks', 'homeworks'], ['/teacher/contests', 'contests'], ['/teacher/problems', 'problems'], ['/teacher/problem-lists', 'problem-lists'], ['/teacher/rankings', 'rankings'], ['/teacher/school', 'campus'], ['/teacher', 'overview'],
  ['/student/homeworks', 'homeworks'], ['/student/contests', 'contests'], ['/student/team', 'teams'], ['/student/problem-lists', 'problem-lists'], ['/student/rating', 'rankings'], ['/student/school', 'campus'], ['/student', 'overview'],
]

export function workspaceModule(pathname: string) {
  const match = moduleByLegacyPath.find(([path]) => pathname === path || pathname.startsWith(`${path}/`))
  return match?.[1] || 'overview'
}

export function workspaceHref(workspace: WorkspaceSummary, module: string) {
  if (workspace.type === 'personal') return module === 'overview' ? '/personal' : `/personal/${module === 'homeworks' ? 'contests' : module}`
  const target = workspace.availableModules.includes(module) ? module : 'overview'
  return `/org/${workspace.organizationId}/${target}`
}
