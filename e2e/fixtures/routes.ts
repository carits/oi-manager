import type { AuthRole } from './auth'
import type { FixtureIds } from './data'

export type RouteOwner = AuthRole | 'public'

export const routePatterns = [
  '/',
  '/login',
  '/identity',
  '/super_admin',
  '/admin',
  '/admin/platform-bindings',
  '/admin/profile',
  '/admin/schools',
  '/admin/schools/[id]',
  '/admin/schools/[id]/edit',
  '/admin/schools/new',
  '/admin/security',
  '/admin/users',
  '/admin/users/[id]',
  '/admin/users/new-platform-admin',
  '/platform-admin',
  '/platform-admin/oj-accounts',
  '/platform-admin/platform-bindings',
  '/platform-admin/carits',
  '/platform-admin/contributions',
  '/platform-admin/problems',
  '/platform-admin/problems/[id]',
  '/platform-admin/problems/[id]/edit',
  '/platform-admin/problems/[id]/note',
  '/platform-admin/problems/new',
  '/platform-admin/submissions',
  '/platform-admin/submissions/[id]',
  '/platform-admin/users',
  '/profile/student/[id]',
  '/profile/teacher/[id]',
  '/profile/user/[id]',
  '/account/platform-bindings',
  '/account/wallet',
  '/account/profile',
  '/account/security',
  '/personal',
  '/personal/campus',
  '/personal/contests',
  '/personal/contests/[id]',
  '/personal/problem-lists',
  '/personal/problem-lists/[id]',
  '/personal/problem-lists/[id]/edit',
  '/personal/problem-lists/new',
  '/personal/problems',
  '/personal/problems/[id]',
  '/personal/carits',
  '/personal/contributions',
  '/personal/rankings',
  '/org/[organizationId]/[module]',
  '/personal/submissions',
  '/personal/submissions/[id]',
  '/personal/teams',
  '/personal/teams/[id]',
  '/personal/teams/[id]/contests/[cid]',
  '/personal/teams/[id]/trainings/[tid]',
  '/student',
  '/student/contests',
  '/student/contests/[cid]',
  '/student/homeworks',
  '/student/homeworks/[cid]',
  '/student/platform-bindings',
  '/student/problem-lists',
  '/student/problem-lists/[id]',
  '/student/problem-lists/new',
  '/student/problems',
  '/student/problems/[id]',
  '/student/problems/[id]/edit',
  '/student/problems/[id]/note',
  '/student/problems/new',
  '/student/profile',
  '/student/rating',
  '/student/school',
  '/student/carits',
  '/student/contributions',
  '/student/school/contests/[cid]',
  '/student/scores',
  '/student/security',
  '/student/submissions',
  '/student/submissions/[id]',
  '/student/team',
  '/student/team/[id]',
  '/student/team/[id]/contests/[cid]',
  '/student/team/[id]/trainings/[tid]',
  '/student/team/browse',
  '/teacher',
  '/teacher/contests',
  '/teacher/homeworks',
  '/teacher/homeworks/[cid]',
  '/teacher/platform-bindings',
  '/teacher/problem-lists',
  '/teacher/problem-lists/[id]',
  '/teacher/problem-lists/new',
  '/teacher/problems',
  '/teacher/problems/[id]',
  '/teacher/problems/[id]/edit',
  '/teacher/problems/[id]/note',
  '/teacher/problems/new',
  '/teacher/profile',
  '/teacher/rankings',
  '/teacher/school',
  '/teacher/school/contests/[cid]',
  '/teacher/school-teachers',
  '/teacher/scores',
  '/teacher/security',
  '/teacher/students',
  '/teacher/students/import',
  '/teacher/students/import/bind',
  '/teacher/students/import/input',
  '/teacher/students/import/preview',
  '/teacher/students/import/result',
  '/teacher/submissions',
  '/teacher/submissions/[id]',
  '/teacher/carits',
  '/teacher/contributions',
  '/teacher/teachers',
  '/teacher/team-import/luogu',
  '/teacher/team-import/vjudge',
  '/teacher/teams',
  '/teacher/teams/[id]',
  '/teacher/teams/[id]/contests/[cid]',
  '/teacher/teams/[id]/homeworks/[cid]',
  '/teacher/teams/[id]/trainings/[tid]',
] as const

export type RoutePattern = (typeof routePatterns)[number]

export function routeOwner(pattern: RoutePattern): RouteOwner {
  if (pattern === '/' || pattern === '/login') return 'public'
  if (pattern === '/profile/student/[id]') return 'campusStudent'
  if (pattern === '/profile/teacher/[id]') return 'principal'
  if (pattern === '/profile/user/[id]') return 'personalStudent'
  if (pattern.startsWith('/personal')) return 'personalStudent'
  if (pattern.startsWith('/org')) return 'campusStudent'
  if (pattern.startsWith('/account')) return 'campusStudent'
  if (pattern === '/super_admin' || pattern.startsWith('/admin')) return 'superAdmin'
  if (pattern.startsWith('/platform-admin')) return 'platformAdmin'
  if (pattern.startsWith('/teacher')) return 'principal'
  if (
    pattern.startsWith('/student/problems') ||
    pattern.startsWith('/student/submissions')
  ) {
    return 'personalStudent'
  }
  return 'campusStudent'
}

export function resolveRoute(pattern: RoutePattern, ids: FixtureIds): string {
  let route = pattern

  if (route.includes('/org/[organizationId]/[module]')) return `/org/org_${ids.school}/overview`

  if (route.includes('/schools/[id]')) route = route.replace('[id]', ids.school)
  else if (route.includes('/users/[id]')) route = route.replace('[id]', ids.users.platformAdmin)
  else if (route.includes('/personal/teams/[id]')) route = route.replace('[id]', ids.personalTeam)
  else if (route.includes('/personal/problems/[id]')) route = route.replace('[id]', ids.problem)
  else if (route.includes('/personal/problem-lists/[id]')) route = route.replace('[id]', ids.personalProblemList)
  else if (route.includes('/personal/submissions/[id]')) route = route.replace('[id]', ids.personalSubmission)
  else if (route.includes('/personal/contests/[id]')) route = route.replace('[id]', ids.personalContest)
  else if (route.includes('/student/problems/[id]')) route = route.replace('[id]', ids.problem)
  else if (route.includes('/problems/[id]')) route = route.replace('[id]', ids.problem)
  else if (route.includes('/problem-lists/[id]')) route = route.replace('[id]', ids.problemList)
  else if (route.includes('/student/submissions/[id]')) route = route.replace('[id]', ids.personalSubmission)
  else if (route.includes('/submissions/[id]')) route = route.replace('[id]', ids.submission)
  else if (route.includes('/profile/student/[id]')) route = route.replace('[id]', ids.users.campusStudent)
  else if (route.includes('/profile/teacher/[id]')) route = route.replace('[id]', ids.users.principal)
  else if (route.includes('/profile/user/[id]')) route = route.replace('[id]', ids.users.personalStudent)
  else if (route.includes('/team/[id]') || route.includes('/teams/[id]')) {
    route = route.replace('[id]', ids.team)
  }

  route = route
    .replace('[tid]', route.startsWith('/personal/') ? ids.personalContest : ids.homework)
    .replace('[cid]', route.startsWith('/personal/') ? ids.personalContest : route.includes('/homeworks/') ? ids.homework : ids.contest)

  return route
}

export const compactPatterns = new Set<RoutePattern>(routePatterns)
