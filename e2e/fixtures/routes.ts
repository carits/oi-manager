import type { AuthRole } from './auth'
import type { FixtureIds } from './data'

export type RouteOwner = AuthRole | 'public'

export const routePatterns = [
  '/',
  '/account/platform-bindings',
  '/account/notifications',
  '/account/messages',
  '/account/profile',
  '/account/security',
  '/account/wallet',
  '/admin',
  '/admin/blog-moderation',
  '/admin/chat-reports',
  '/admin/contests',
  '/admin/contests/[id]',
  '/admin/contests/[id]/statements',
  '/admin/contributions',
  '/admin/knowledge',
  '/admin/knowledge/[id]',
  '/admin/platform-bindings',
  '/admin/profile',
  '/admin/schools',
  '/admin/schools/[id]',
  '/admin/schools/[id]/edit',
  '/admin/schools/new',
  '/admin/security',
  '/admin/submissions',
  '/admin/submissions/[id]',
  '/admin/users',
  '/admin/users/[id]',
  '/admin/users/new-platform-admin',
  '/blog',
  '/blog/[id]',
  '/identity',
  '/login',
  '/org/[organizationId]/[module]',
  '/org/[organizationId]/[module]/[...segments]',
  '/personal',
  '/personal/blogs',
  '/personal/blogs/[id]',
  '/personal/blogs/new',
  '/personal/blogs/series',
  '/personal/campus',
  '/personal/carits',
  '/personal/contests',
  '/personal/contests/[id]',
  '/personal/contests/[id]/statements',
  '/personal/contributions',
  '/personal/data-market',
  '/personal/knowledge',
  '/personal/knowledge/[id]',
  '/personal/organizations',
  '/personal/problem-lists',
  '/personal/problem-lists/[id]',
  '/personal/problem-lists/[id]/edit',
  '/personal/problem-lists/new',
  '/personal/problems',
  '/personal/problems/[id]',
  '/personal/rankings',
  '/personal/submissions',
  '/personal/submissions/[id]',
  '/personal/teams',
  '/personal/teams/[id]',
  '/personal/teams/[id]/contests/[cid]',
  '/personal/teams/[id]/contests/[cid]/statements',
  '/personal/teams/[id]/contests/[cid]',
  '/personal/teams/[id]/contests/[cid]/statements',
  '/personal/training-sessions',
  '/personal/training-sessions/[id]',
  '/personal/training-sessions/[id]/design',
  '/platform-admin',
  '/platform-admin/blog-moderation',
  '/platform-admin/chat-reports',
  '/platform-admin/contests',
  '/platform-admin/contests/[id]',
  '/platform-admin/contests/[id]/statements',
  '/platform-admin/ai',
  '/platform-admin/carits',
  '/platform-admin/contributions',
  '/platform-admin/data-market',
  '/platform-admin/knowledge',
  '/platform-admin/knowledge/[id]',
  '/platform-admin/oj-accounts',
  '/platform-admin/platform-bindings',
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
  '/super_admin',
] as const

export type RoutePattern = typeof routePatterns[number]

export function routeOwner(pattern: RoutePattern): RouteOwner {
  if (pattern === '/' || pattern === '/login' || pattern === '/blog' || pattern === '/blog/[id]') return 'public'
  if (pattern === '/personal/training-sessions/[id]/design') return 'principal'
  if (pattern === '/profile/student/[id]') return 'campusStudent'
  if (pattern === '/profile/teacher/[id]') return 'principal'
  if (pattern === '/profile/user/[id]') return 'personalStudent'
  if (pattern.startsWith('/personal')) return 'personalStudent'
  if (pattern === '/org/[organizationId]/[module]') return 'campusStudent'
  if (pattern.startsWith('/org')) return 'principal'
  if (pattern.startsWith('/account') || pattern === '/identity') return 'campusStudent'
  if (pattern === '/super_admin' || pattern.startsWith('/admin')) return 'superAdmin'
  if (pattern.startsWith('/platform-admin')) return 'platformAdmin'
  return 'campusStudent'
}

export function resolveRoute(pattern: RoutePattern, ids: FixtureIds): string {

  if (pattern === '/org/[organizationId]/[module]') {
    return `/org/org_${ids.school}/overview`
  }
  if (pattern === '/org/[organizationId]/[module]/[...segments]') {
    return `/org/org_${ids.school}/problems/${ids.problem}`
  }

  let route: string = pattern
  if (route.includes('/admin/schools/[id]')) route = route.replace('[id]', `org_${ids.school}`)
  else if (route.includes('/admin/users/[id]')) route = route.replace('[id]', ids.users.platformAdmin)
  else if (route.includes('/personal/teams/[id]')) route = route.replace('[id]', ids.personalTeam)
  else if (route.includes('/personal/problems/[id]')) route = route.replace('[id]', ids.personalProblem)
  else if (route.includes('/personal/problem-lists/[id]')) route = route.replace('[id]', ids.personalProblemList)
  else if (route.includes('/personal/submissions/[id]')) route = route.replace('[id]', ids.personalSubmission)
  else if (route.includes('/personal/contests/[id]')) route = route.replace('[id]', ids.personalContest)
  else if (route.includes('/admin/contests/[id]')) route = route.replace('[id]', ids.personalContest)
  else if (route.includes('/platform-admin/contests/[id]')) route = route.replace('[id]', ids.personalContest)
  else if (route.includes('/personal/blogs/[id]') || route.includes('/blog/[id]') || route.includes('/knowledge/[id]')) route = route.replace('[id]', 'missing-blog')
  else if (route.includes('/personal/training-sessions/[id]')) route = route.replace('[id]', ids.trainingSession)
  else if (route.includes('/platform-admin/problems/[id]')) route = route.replace('[id]', ids.problem)
  else if (route.includes('/platform-admin/submissions/[id]')) route = route.replace('[id]', ids.submission)
  else if (route.includes('/admin/submissions/[id]')) route = route.replace('[id]', ids.submission)
  else if (route.includes('/profile/student/[id]')) route = route.replace('[id]', ids.users.campusStudent)
  else if (route.includes('/profile/teacher/[id]')) route = route.replace('[id]', ids.users.principal)
  else if (route.includes('/profile/user/[id]')) route = route.replace('[id]', ids.users.personalStudent)

  return route
    .replace('[cid]', ids.personalContest)
    .replace('[tid]', ids.personalContest)
}

export const compactPatterns = new Set<RoutePattern>(routePatterns)
