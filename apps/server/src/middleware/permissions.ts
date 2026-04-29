/**
 * 资源级权限判断中间件
 *
 * 用于检查用户是否有权访问特定资源（学校、学生、教师、团队等）
 */

import { prisma } from '../prisma'
import { AuthRequest } from './auth'
import logger from '../lib/logger'

/**
 * 角色权限定义：
 * - super_admin: 所有数据
 * - platform_admin: 所有用户（不含超管/平台管理员）
 * - school_principal: 本校数据
 * - teacher: 本校数据 + 自己的团队 + 自己作为主教练的学生
 * - student: 自己的数据 + 所属团队
 */

// ==================== 辅助函数 ====================

/**
 * 记录权限拒绝日志
 */
function logPermissionDenied(
  req: AuthRequest,
  action: string,
  resourceType: string,
  resourceId: string,
  reason?: string
): void {
  logger.security('permission_denied', {
    userId: req.user?.userId,
    role: req.user?.role,
    action: 'access_resource',
    metadata: {
      resourceType,
      resourceId,
      attemptedAction: action,
      reason
    }
  })
}

/**
 * 获取用户关联的学校 ID
 */
export async function getUserSchoolId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { Teacher: true, Student: true }
  })
  return user?.Teacher?.schoolId || user?.Student?.schoolId || null
}

/**
 * 获取用户的教师 ID
 */
export async function getUserTeacherId(userId: string): Promise<string | null> {
  const teacher = await prisma.teacher.findUnique({
    where: { id: userId }
  })
  return teacher?.id || null
}

/**
 * 获取用户的学生 ID
 */
export async function getUserStudentId(userId: string): Promise<string | null> {
  const student = await prisma.student.findUnique({
    where: { id: userId }
  })
  return student?.id || null
}

// ==================== 学校权限 ====================

/**
 * 判断用户是否可以访问学校数据
 * 规则：
 * - super_admin, platform_admin: 可访问所有学校
 * - 其他角色: 只能访问本校
 */
export async function canAccessSchool(req: AuthRequest, schoolId: string): Promise<boolean> {
  const role = req.user!.role

  // 超管和平台管理员可以访问所有学校
  if (role === 'super_admin' || role === 'platform_admin') return true

  // 其他角色只能访问本校
  const userSchoolId = await getUserSchoolId(req.user!.userId)
  const hasAccess = userSchoolId === schoolId

  if (!hasAccess) {
    logPermissionDenied(req, 'access_school', 'school', schoolId, '用户不属于该学校')
  }

  return hasAccess
}

/**
 * 判断用户是否可以管理学校（编辑、设置负责人等）
 * 规则：
 * - super_admin: 可管理所有学校
 * - school_principal: 可管理本校
 * - 其他: 无权限
 */
export async function canManageSchool(req: AuthRequest, schoolId: string): Promise<boolean> {
  const role = req.user!.role

  // 超管可以管理所有学校
  if (role === 'super_admin') return true

  // 学校负责人只能管理本校
  if (role === 'school_principal') {
    const userSchoolId = await getUserSchoolId(req.user!.userId)
    const hasAccess = userSchoolId === schoolId

    if (!hasAccess) {
      logPermissionDenied(req, 'manage_school', 'school', schoolId, '学校负责人只能管理本校')
    }

    return hasAccess
  }

  logPermissionDenied(req, 'manage_school', 'school', schoolId, '角色无管理权限')
  return false
}

// ==================== 学生权限 ====================

/**
 * 判断用户是否可以查看学生详情
 * 规则：
 * - super_admin, platform_admin: 可查看所有学生
 * - school_principal: 可查看本校所有学生
 * - teacher: 可查看本校学生
 * - student: 只能查看自己
 */
export async function canViewStudent(req: AuthRequest, studentId: string): Promise<boolean> {
  const role = req.user!.role

  // 超管和平台管理员可以查看所有学生
  if (role === 'super_admin' || role === 'platform_admin') return true

  // 获取学生信息
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { schoolId: true }
  })
  if (!student) {
    logPermissionDenied(req, 'view_student', 'student', studentId, '学生不存在')
    return false
  }

  // 学生只能查看自己
  if (role === 'student') {
    const hasAccess = studentId === req.user!.userId
    if (!hasAccess) {
      logPermissionDenied(req, 'view_student', 'student', studentId, '学生只能查看自己')
    }
    return hasAccess
  }

  // 教师/学校负责人检查学校归属
  const userSchoolId = await getUserSchoolId(req.user!.userId)
  const hasAccess = userSchoolId === student.schoolId
  if (!hasAccess) {
    logPermissionDenied(req, 'view_student', 'student', studentId, '不属于同一学校')
  }
  return hasAccess
}

/**
 * 判断用户是否可以管理学生（编辑、删除）
 * 规则：
 * - super_admin, platform_admin: 可管理所有学生
 * - school_principal: 可管理本校所有学生
 * - teacher: 只能管理自己作为主教练的学生
 */
export async function canManageStudent(req: AuthRequest, studentId: string): Promise<boolean> {
  const role = req.user!.role

  // 超管和平台管理员可以管理所有学生
  if (role === 'super_admin' || role === 'platform_admin') return true

  // 获取学生信息
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { schoolId: true, headTeacherId: true }
  })
  if (!student) {
    logPermissionDenied(req, 'manage_student', 'student', studentId, '学生不存在')
    return false
  }

  // 学生不能管理其他学生
  if (role === 'student') {
    logPermissionDenied(req, 'manage_student', 'student', studentId, '学生不能管理其他学生')
    return false
  }

  // 检查学校归属
  const userSchoolId = await getUserSchoolId(req.user!.userId)
  if (userSchoolId !== student.schoolId) {
    logPermissionDenied(req, 'manage_student', 'student', studentId, '不属于同一学校')
    return false
  }

  // 学校负责人可以管理本校所有学生
  if (role === 'school_principal') return true

  // 普通教师只能管理自己作为主教练的学生
  const teacherId = await getUserTeacherId(req.user!.userId)
  const hasAccess = student.headTeacherId === teacherId
  if (!hasAccess) {
    logPermissionDenied(req, 'manage_student', 'student', studentId, '教师只能管理自己作为主教练的学生')
  }
  return hasAccess
}

// ==================== 教师权限 ====================

/**
 * 判断用户是否可以查看教师详情
 * 规则：
 * - super_admin, platform_admin: 可查看所有教师
 * - school_principal: 可查看本校所有教师
 * - teacher: 可查看本校教师
 * - student: 可查看本校教师（用于查看主教练等）
 */
export async function canViewTeacher(req: AuthRequest, teacherId: string): Promise<boolean> {
  const role = req.user!.role

  // 超管和平台管理员可以查看所有教师
  if (role === 'super_admin' || role === 'platform_admin') return true

  // 获取教师信息
  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    select: { schoolId: true }
  })
  if (!teacher) {
    logPermissionDenied(req, 'view_teacher', 'teacher', teacherId, '教师不存在')
    return false
  }

  // 检查学校归属
  const userSchoolId = await getUserSchoolId(req.user!.userId)
  const hasAccess = userSchoolId === teacher.schoolId
  if (!hasAccess) {
    logPermissionDenied(req, 'view_teacher', 'teacher', teacherId, '不属于同一学校')
  }
  return hasAccess
}

/**
 * 判断用户是否可以管理教师（编辑、禁用、删除）
 * 规则：
 * - super_admin: 可管理所有教师
 * - school_principal: 可管理本校教师（不能管理自己）
 */
export async function canManageTeacher(req: AuthRequest, teacherId: string): Promise<boolean> {
  const role = req.user!.role

  // 超管可以管理所有教师
  if (role === 'super_admin') return true

  // 获取教师信息
  const teacher = await prisma.teacher.findUnique({
    where: { id: teacherId },
    select: { schoolId: true }
  })
  if (!teacher) {
    logPermissionDenied(req, 'manage_teacher', 'teacher', teacherId, '教师不存在')
    return false
  }

  // 学校负责人检查
  if (role === 'school_principal') {
    const userSchoolId = await getUserSchoolId(req.user!.userId)
    // 只能管理本校教师
    if (userSchoolId !== teacher.schoolId) {
      logPermissionDenied(req, 'manage_teacher', 'teacher', teacherId, '学校负责人只能管理本校教师')
      return false
    }
    // 不能管理自己
    const userTeacherId = await getUserTeacherId(req.user!.userId)
    const hasAccess = userTeacherId !== teacherId
    if (!hasAccess) {
      logPermissionDenied(req, 'manage_teacher', 'teacher', teacherId, '不能管理自己')
    }
    return hasAccess
  }

  logPermissionDenied(req, 'manage_teacher', 'teacher', teacherId, '角色无管理权限')
  return false
}

// ==================== 团队权限 ====================

/**
 * 判断用户是否可以查看团队
 * 规则：
 * - super_admin, platform_admin: 可查看所有团队
 * - 公开团队: 本校用户可查看
 * - 私有团队: 只有成员可查看
 */
export async function canViewTeam(req: AuthRequest, teamId: string): Promise<boolean> {
  const role = req.user!.role

  // 超管和平台管理员可以查看所有团队
  if (role === 'super_admin' || role === 'platform_admin') return true

  // 获取团队信息
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { schoolId: true, isPublic: true }
  })
  if (!team) {
    logPermissionDenied(req, 'view_team', 'team', teamId, '团队不存在')
    return false
  }

  // 检查学校归属
  const userSchoolId = await getUserSchoolId(req.user!.userId)

  // 公开团队：本校用户可查看
  if (team.isPublic) {
    const hasAccess = userSchoolId === team.schoolId
    if (!hasAccess) {
      logPermissionDenied(req, 'view_team', 'team', teamId, '公开团队仅限本校用户查看')
    }
    return hasAccess
  }

  // 私有团队：检查是否为成员
  const member = await prisma.teamMember.findFirst({
    where: {
      teamId,
      OR: [
        { userId: req.user!.userId },
        { userId: await getUserTeacherId(req.user!.userId), userType: 'teacher' },
        { userId: await getUserStudentId(req.user!.userId), userType: 'student' }
      ].filter(m => m.userId !== null) as Array<{ userId: string; userType: string }>
    }
  })
  const hasAccess = !!member
  if (!hasAccess) {
    logPermissionDenied(req, 'view_team', 'team', teamId, '私有团队仅限成员查看')
  }
  return hasAccess
}

/**
 * 判断用户是否可以管理团队（编辑、删除、成员管理）
 * 规则：
 * - super_admin: 可管理所有团队
 * - owner: 可管理团队
 * - admin: 部分管理权限
 */
export async function canManageTeam(req: AuthRequest, teamId: string): Promise<boolean> {
  const role = req.user!.role

  // 超管可以管理所有团队
  if (role === 'super_admin') return true

  // 获取用户在团队中的角色
  const teacherId = await getUserTeacherId(req.user!.userId)
  const studentId = await getUserStudentId(req.user!.userId)

  const member = await prisma.teamMember.findFirst({
    where: {
      teamId,
      OR: [
        ...(teacherId ? [{ userId: teacherId, userType: 'teacher' as const }] : []),
        ...(studentId ? [{ userId: studentId, userType: 'student' as const }] : [])
      ],
      status: 'active'
    }
  })

  // owner 或 admin 可以管理
  const hasAccess = member?.role === 'owner' || member?.role === 'admin'
  if (!hasAccess) {
    logPermissionDenied(req, 'manage_team', 'team', teamId, '需要 owner 或 admin 权限')
  }
  return hasAccess
}

/**
 * 获取用户在团队中的角色
 */
export async function getTeamMemberRole(teamId: string, userId: string): Promise<'owner' | 'admin' | 'member' | null> {
  // 获取用户的教师 ID 和学生 ID
  const teacher = await prisma.teacher.findUnique({ where: { id: userId } })
  const student = await prisma.student.findUnique({ where: { id: userId } })

  const member = await prisma.teamMember.findFirst({
    where: {
      teamId,
      OR: [
        ...(teacher ? [{ userId: teacher.id, userType: 'teacher' as const }] : []),
        ...(student ? [{ userId: student.id, userType: 'student' as const }] : [])
      ],
      status: 'active'
    }
  })

  return member?.role as 'owner' | 'admin' | 'member' | null || null
}