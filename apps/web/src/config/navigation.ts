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
    { label: '学校管理', href: '/admin/schools' },
    { label: '账号管理', href: '/admin/users' },
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
    { label: '提交管理', href: '/platform-admin/oj-accounts' },
  ]
}

// 学校负责人导航
export const schoolManagerNav: NavConfig = {
  role: 'school_principal',
  items: [
    { label: '首页', href: '/teacher' },
    { label: '我的团队', href: '/teacher/teams' },
    { label: '我的学校', href: '/teacher/school' },
    { label: '学生管理', href: '/teacher/students' },
    { label: '教师管理', href: '/teacher/teachers' },
    { label: '题库', href: '/teacher/problems' },
    { label: '题单', href: '/teacher/problem-lists' },
    { label: '评测记录', href: '/teacher/submissions' },
  ]
}

// 教师导航
export const teacherNav: NavConfig = {
  role: 'teacher',
  items: [
    { label: '首页', href: '/teacher' },
    { label: '我的团队', href: '/teacher/teams' },
    { label: '我的学校', href: '/teacher/school' },
    { label: '学生管理', href: '/teacher/students' },
    { label: '教师管理', href: '/teacher/teachers' },
    { label: '题库', href: '/teacher/problems' },
    { label: '题单', href: '/teacher/problem-lists' },
    { label: '评测记录', href: '/teacher/submissions' },
  ]
}

// 学生导航
export const studentNav: NavConfig = {
  role: 'student',
  items: [
    { label: '首页', href: '/student' },
    { label: '我的团队', href: '/student/team' },
    { label: '我的学校', href: '/student/school' },
    { label: '题库', href: '/student/problems' },
    { label: '题单', href: '/student/problem-lists' },
    { label: '评测记录', href: '/student/submissions' },
    { label: '我的成长', href: '/student/rating' },
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
export function getNavConfig(role: UserRole | string): NavConfig {
  const validRole = role as UserRole
  if (validRole === 'super_admin') return superAdminNav
  if (validRole === 'platform_admin') return platformAdminNav
  if (validRole === 'school_principal') return schoolManagerNav
  if (validRole === 'teacher') return teacherNav
  if (validRole === 'student') return studentNav
  // 默认返回教师导航
  return teacherNav
}

// 根据路径获取当前激活的 nav item
export function getActiveNavItem(href: string, role: UserRole | string): string {
  const config = getNavConfig(role)
  const pathname = href.split('?')[0]

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
