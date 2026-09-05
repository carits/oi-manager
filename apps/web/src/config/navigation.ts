// 统一导航配置
// 角色: super_admin | platform_admin | school_principal | teacher | student

export type UserRole = 'super_admin' | 'platform_admin' | 'school_principal' | 'teacher' | 'student'

export interface NavItem {
  label: string
  href: string
  icon?: string
}

export interface NavConfig {
  role: UserRole
  items: NavItem[]
}

// 超管导航
export const superAdminNav: NavConfig = {
  role: 'super_admin',
  items: [
    { label: '概览', href: '/admin' },
    { label: '学校管理', href: '/admin/schools' },
    { label: '账号管理', href: '/admin/users' },
    { label: '评测记录', href: '/admin/submissions' },
    { label: '私信举报', href: '/admin/chat-reports' },
  ]
}

// 平台管理员导航
export const platformAdminNav: NavConfig = {
  role: 'platform_admin',
  items: [
    { label: '首页', href: '/platform-admin' },
    { label: '账号管理', href: '/platform-admin/users' },
    { label: '题库管理', href: '/platform-admin/problems' },
    { label: '评测记录', href: '/platform-admin/submissions' },
    { label: 'OJ账号', href: '/platform-admin/oj-accounts' },
    { label: 'AI Token', href: '/platform-admin/ai' },
    { label: '私信举报', href: '/platform-admin/chat-reports' },
  ]
}

// 学校负责人导航（校园模式）
export const schoolManagerNav: NavConfig = {
  role: 'school_principal',
  items: [
    { label: '概览', href: 'overview' },
    { label: '校园', href: 'campus' },
    { label: '管理', href: 'management' },
    { label: '团队', href: 'teams' },
    { label: '作业', href: 'homeworks' },
    { label: '比赛', href: 'contests' },
    { label: '题库', href: 'problems' },
    { label: '题单', href: 'problem-lists' },
    { label: '排名', href: 'rankings' },
  ]
}

// 教师导航（校园模式）
export const teacherNav: NavConfig = {
  role: 'teacher',
  items: [
    { label: '概览', href: 'overview' },
    { label: '校园', href: 'campus' },
    { label: '管理', href: 'management' },
    { label: '团队', href: 'teams' },
    { label: '作业', href: 'homeworks' },
    { label: '比赛', href: 'contests' },
    { label: '题库', href: 'problems' },
    { label: '题单', href: 'problem-lists' },
    { label: '排名', href: 'rankings' },
  ]
}

// 学生导航（校园模式）
export const studentNav: NavConfig = {
  role: 'student',
  items: [
    { label: '校园', href: 'campus' },
    { label: '团队', href: 'teams' },
    { label: '作业', href: 'homeworks' },
    { label: '比赛', href: 'contests' },
    { label: '题单', href: 'problem-lists' },
    { label: '排名', href: 'rankings' },
  ]
}

// 所有角色共享的个人工作区导航
export const personalNav: NavConfig = {
  role: 'student',
  items: [
    { label: '首页', href: '/personal' },
    { label: '组织', href: '/personal/organizations' },
    { label: '团队', href: '/personal/teams' },
    { label: '题库', href: '/personal/problems' },
    { label: '比赛', href: '/personal/contests' },
    { label: '题单', href: '/personal/problem-lists' },
    { label: '排名', href: '/personal/rankings' },
    { label: '评测记录', href: '/personal/submissions' },
  ]
}

// 角色到导航配置的映射
export const roleNavMap: Record<UserRole, NavConfig> = {
  super_admin: superAdminNav,
  platform_admin: platformAdminNav,
  school_principal: schoolManagerNav,
  teacher: teacherNav,
  student: studentNav,
}

// 根据角色获取导航配置
export function getNavConfig(role: UserRole | string, context?: string): NavConfig {
  const validRole = role as UserRole
  // 全局管理员没有个人工作区，始终使用平台管理导航。
  if (validRole === 'super_admin') return superAdminNav
  if (validRole === 'platform_admin') return platformAdminNav
  if (context === 'personal') return { ...personalNav, role: validRole }
  if (validRole === 'school_principal') return schoolManagerNav
  if (validRole === 'teacher') return teacherNav
  if (validRole === 'student') return studentNav
  // 默认返回教师导航
  return teacherNav
}

// 根据路径获取当前激活的 nav item
export function getActiveNavItem(href: string, role: UserRole | string, context?: string): string {
  const config = getNavConfig(role, context)
  const pathname = href.split('?')[0]
  const organizationModule = context !== 'personal' ? pathname.match(/^\/org\/[^/]+\/([^/]+)/)?.[1] : null
  if (organizationModule) return config.items.find(item => item.href === organizationModule)?.label || ''

  let bestMatch = ''
  let bestMatchLength = 0

  for (const item of config.items) {
    // 精确匹配首页
    if (item.href === pathname) {
      return item.label
    }
    // 对于其他页面，检查是否是该路径的前缀
    // 使用最长匹配原则
    if (pathname.startsWith(item.href) && item.href !== '/') {
      if (item.href.length > bestMatchLength) {
        bestMatch = item.label
        bestMatchLength = item.href.length
      }
    }
  }
  return bestMatch
}

// 角色显示名称
export const roleLabels: Record<UserRole, string> = {
  super_admin: '超管',
  platform_admin: '平台管理员',
  school_principal: '学校负责人',
  teacher: '教师',
  student: '学生',
}

// 角色中文名称
export const roleNames: Record<UserRole, string> = {
  super_admin: '超级管理员',
  platform_admin: '平台管理员',
  school_principal: '学校负责人',
  teacher: '教师',
  student: '学生',
}
