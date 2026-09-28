import type { AccountRole, OrganizationMembershipRole } from '@oi-manager/contracts'
export type NavigationRole = AccountRole | OrganizationMembershipRole
export interface NavItem { label: string; href: string; icon?: string; scope?: 'workspace' | 'global'; group?: string }
export interface NavConfig { role: NavigationRole; items: NavItem[] }

export const superAdminNav: NavConfig = { role: 'super_admin', items: [
  { label: '概览', href: '/admin' },
  { label: '学校管理', href: '/admin/schools', group: '账号与学校' },
  { label: '账号管理', href: '/admin/users', group: '账号与学校' },
  { label: '比赛', href: '/admin/contests', group: '内容' },
  { label: '知识广场', href: '/admin/knowledge', group: '内容' },
  { label: '博客治理', href: '/admin/blog-moderation', group: '内容' },
  { label: '评测记录', href: '/admin/submissions', group: '评测' },
  { label: '贡献审计', href: '/admin/contributions', group: '经济系统' },
  { label: '私信举报', href: '/admin/chat-reports', group: '治理' },
] }
export const platformAdminNav: NavConfig = { role: 'platform_admin', items: [
  { label: '首页', href: '/platform-admin' },
  { label: '账号管理', href: '/platform-admin/users', group: '账号与学校' },
  { label: '题库管理', href: '/platform-admin/problems', group: '内容' },
  { label: '比赛', href: '/platform-admin/contests', group: '内容' },
  { label: '知识广场', href: '/platform-admin/knowledge', group: '内容' },
  { label: '博客治理', href: '/platform-admin/blog-moderation', group: '内容' },
  { label: '评测记录', href: '/platform-admin/submissions', group: '评测' },
  { label: 'OJ账号', href: '/platform-admin/oj-accounts', group: '评测' },
  { label: 'AI Token', href: '/platform-admin/ai', group: '评测' },
  { label: '贡献审计', href: '/platform-admin/contributions', group: '经济系统' },
  { label: '数据市场', href: '/platform-admin/data-market', group: '经济系统' },
  { label: '私信举报', href: '/platform-admin/chat-reports', group: '治理' },
] }

// Student management remains a first-level destination; school tabs have one parent.
const teachingItems: NavItem[] = [
  { label: '首页', href: 'overview' },
  { label: '作业', href: 'homeworks', group: '教学' },
  { label: '比赛', href: 'contests', group: '教学' },
  { label: '训练', href: 'training-sessions', group: '教学' },
  { label: '题库', href: 'problems', group: '教学' },
  { label: '题单', href: 'problem-lists', group: '教学' },
  { label: '评测记录', href: 'submissions', group: '教学' },
  { label: '学生', href: 'management?tab=students', group: '学生与团队' },
  { label: '团队', href: 'teams', group: '学生与团队' },
  { label: '排名', href: 'rankings', group: '学生与团队' },
  { label: '学校信息', href: 'campus', group: '学校' },
  { label: '学校管理', href: 'management?tab=applications', group: '学校' },
  { label: '知识广场', href: 'knowledge', group: '社区' },
]
export const schoolManagerNav: NavConfig = { role: 'school_principal', items: teachingItems }
export const teacherNav: NavConfig = { role: 'teacher', items: teachingItems }
export const studentNav: NavConfig = { role: 'student', items: [
  { label: '首页', href: 'overview' },
  { label: '作业', href: 'homeworks', group: '学习' },
  { label: '比赛', href: 'contests', group: '学习' },
  { label: '训练', href: 'training-sessions', group: '学习' },
  { label: '题单', href: 'problem-lists', group: '学习' },
  { label: '评测记录', href: 'submissions', group: '学习' },
  { label: '团队', href: 'teams', group: '社区' },
  { label: '排名', href: 'rankings', group: '社区' },
  { label: '知识广场', href: 'knowledge', group: '社区' },
  { label: '学校信息', href: 'campus', group: '学校' },
] }
export const personalNav: NavConfig = { role: 'user', items: [
  { label: '首页', href: '/personal' },
  { label: '题库', href: '/personal/problems', group: '学习' },
  { label: '题单', href: '/personal/problem-lists', group: '学习' },
  { label: '训练', href: '/personal/training-sessions', group: '学习' },
  { label: '比赛', href: '/personal/contests', group: '学习' },
  { label: '评测记录', href: '/personal/submissions', group: '学习' },
  { label: '团队', href: '/personal/teams', group: '社区' },
  { label: '知识广场', href: '/personal/knowledge', group: '社区' },
  { label: '我的文章', href: '/personal/blogs', group: '社区' },
  { label: '排名', href: '/personal/rankings', group: '社区' },
  { label: '学校', href: '/personal/organizations', group: '资源' },
  { label: '贡献', href: '/personal/contributions', group: '资源' },
  { label: '数据市场', href: '/personal/data-market', group: '资源' },
  { label: '钱包', href: '/account/wallet', scope: 'global', group: '资源' },
] }
export const roleNavMap: Record<NavigationRole, NavConfig> = { super_admin: superAdminNav, platform_admin: platformAdminNav, school_principal: schoolManagerNav, teacher: teacherNav, student: studentNav, user: personalNav }

export function getNavConfig(role: NavigationRole | string, context?: string): NavConfig {
  const validRole = role as NavigationRole
  if (validRole === 'super_admin') return superAdminNav
  if (validRole === 'platform_admin') return platformAdminNav
  if (context === 'personal') return { ...personalNav, role: validRole }
  if (validRole === 'school_principal') return schoolManagerNav
  if (validRole === 'teacher') return teacherNav
  if (validRole === 'student') return studentNav
  return { role: validRole, items: [] }
}

/** One query-aware match function for the shell and navigation tests. */
export function getActiveNavItem(href: string, role: NavigationRole | string, context?: string): string {
  const config = getNavConfig(role, context)
  const [path, query = ''] = href.split('#')[0].split('?')
  const organizationModule = context !== 'personal' ? path.match(/^\/org\/[^/]+\/([^/]+)/)?.[1] : null
  if (organizationModule === 'management') {
    const tab = new URLSearchParams(query).get('tab') || 'students'
    const target = tab === 'students' ? 'management?tab=students' : 'management?tab=applications'
    return config.items.find(item => item.href === target)?.label || ''
  }
  if (organizationModule) return config.items.find(item => item.href.split('?')[0] === organizationModule)?.label || ''
  let best: NavItem | undefined
  for (const item of config.items) {
    const itemPath = item.href.split('?')[0]
    if (path === itemPath) return item.label
    if (itemPath !== '/personal' && itemPath !== '/admin' && itemPath !== '/platform-admin' && path.startsWith(`${itemPath}/`) && (!best || itemPath.length > best.href.split('?')[0].length)) best = item
  }
  return best?.label || ''
}
export const roleLabels: Record<NavigationRole, string> = { super_admin: '超管', platform_admin: '平台管理员', school_principal: '学校负责人', teacher: '教师', student: '学生', user: '用户' }
export const roleNames: Record<NavigationRole, string> = { super_admin: '超级管理员', platform_admin: '平台管理员', school_principal: '学校负责人', teacher: '教师', student: '学生', user: '普通用户' }
