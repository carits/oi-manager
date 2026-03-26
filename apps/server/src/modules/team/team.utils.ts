/**
 * Team Module - Utility Functions
 * 团队模块工具函数
 */

import { prisma } from '../../prisma'
import type { MemberType, MemberDetails } from './team.types'

/**
 * 根据 userId 和 userType 获取用户名称
 */
export async function getUserName(userId: string, userType: MemberType): Promise<string> {
  if (userType === 'teacher') {
    const teacher = await prisma.teacher.findUnique({
      where: { id: userId },
      select: { name: true }
    })
    return teacher?.name || '未知'
  } else {
    const student = await prisma.student.findUnique({
      where: { id: userId },
      select: { name: true }
    })
    return student?.name || '未知'
  }
}

/**
 * 批量获取用户名称
 * @returns Map<userId, name>
 */
export async function getUserNames(
  userIds: string[],
  userType: MemberType
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()

  if (userType === 'teacher') {
    const teachers = await prisma.teacher.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true }
    })
    return new Map(teachers.map(t => [t.id, t.name]))
  } else {
    const students = await prisma.student.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true }
    })
    return new Map(students.map(s => [s.id, s.name]))
  }
}

/**
 * 获取成员详细信息
 */
export async function getMemberDetails(userId: string, userType: MemberType): Promise<MemberDetails | null> {
  if (userType === 'teacher') {
    const teacher = await prisma.teacher.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatar: true, userId: true, title: true }
    })
    if (!teacher) return null

    const user = await prisma.user.findUnique({
      where: { id: teacher.userId },
      select: { username: true, avatar: true }
    })

    // 优先使用 User 表的头像（用户上传头像时更新的是 User 表）
    return {
      id: teacher.id,
      name: teacher.name,
      avatar: user?.avatar || teacher.avatar,
      userId: teacher.userId,
      username: user?.username || '',
      type: 'teacher',
      title: teacher.title || undefined
    }
  } else {
    const student = await prisma.student.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatar: true, userId: true, rating: true, enrollmentYear: true }
    })
    if (!student) return null

    const user = await prisma.user.findUnique({
      where: { id: student.userId! },
      select: { username: true, avatar: true }
    })

    // 优先使用 User 表的头像（用户上传头像时更新的是 User 表）
    return {
      id: student.id,
      name: student.name,
      avatar: user?.avatar || student.avatar,
      userId: student.userId!,
      username: user?.username || '',
      type: 'student',
      rating: student.rating || undefined,
      enrollmentYear: student.enrollmentYear || undefined
    }
  }
}

/**
 * 批量获取成员详细信息
 */
export async function getMemberDetailsBatch(
  members: Array<{ userId: string; userType: MemberType }>
): Promise<Map<string, MemberDetails>> {
  const result = new Map<string, MemberDetails>()

  // 按类型分组
  const teacherIds = members.filter(m => m.userType === 'teacher').map(m => m.userId)
  const studentIds = members.filter(m => m.userType === 'student').map(m => m.userId)

  // 批量查询教师
  if (teacherIds.length > 0) {
    const teachers = await prisma.teacher.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true, name: true, avatar: true, userId: true, title: true }
    })

    const teacherUserIds = teachers.map(t => t.userId)
    const teacherUsers = await prisma.user.findMany({
      where: { id: { in: teacherUserIds } },
      select: { id: true, username: true, avatar: true }
    })
    const teacherUserMap = new Map(teacherUsers.map(u => [u.id, u]))

    for (const teacher of teachers) {
      const user = teacherUserMap.get(teacher.userId)
      result.set(`teacher:${teacher.id}`, {
        id: teacher.id,
        name: teacher.name,
        avatar: user?.avatar || teacher.avatar,
        userId: teacher.userId,
        username: user?.username || '',
        type: 'teacher',
        title: teacher.title || undefined
      })
    }
  }

  // 批量查询学生
  if (studentIds.length > 0) {
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, name: true, avatar: true, userId: true, rating: true, enrollmentYear: true }
    })

    const studentUserIds = students.map(s => s.userId).filter(Boolean) as string[]
    const studentUsers = await prisma.user.findMany({
      where: { id: { in: studentUserIds } },
      select: { id: true, username: true, avatar: true }
    })
    const studentUserMap = new Map(studentUsers.map(u => [u.id, u]))

    for (const student of students) {
      const user = student.userId ? studentUserMap.get(student.userId) : null
      result.set(`student:${student.id}`, {
        id: student.id,
        name: student.name,
        avatar: user?.avatar || student.avatar,
        userId: student.userId!,
        username: user?.username || '',
        type: 'student',
        rating: student.rating || undefined,
        enrollmentYear: student.enrollmentYear || undefined
      })
    }
  }

  return result
}

/**
 * 格式化团队创建数量限制错误消息
 */
export function formatTeamLimitMessage(isTeacher: boolean): string {
  const maxTeams = isTeacher ? 50 : 5
  return `您创建的团队数量已达上限（${maxTeams}个）`
}

/**
 * 格式化新所有者限制错误消息
 */
export function formatNewOwnerLimitMessage(isTeacher: boolean): string {
  const maxTeams = isTeacher ? 50 : 5
  const type = isTeacher ? '教师' : '学生'
  return `该${type}创建的团队数量已达上限（${maxTeams}个），无法转移`
}

// ==================== Prisma 结果转换 ====================

/**
 * Prisma 关联字段名称映射（大写 → 小写）
 * 用于将 Prisma 返回的大写字段名转换为前端期望的小写字段名
 */
const FIELD_MAPPINGS: Record<string, string> = {
  School: 'school',
  TeamMember: 'members',
  Student: 'student',
  Teacher: 'teacher',
  Admin: 'admin',
  User: 'user'
}

/**
 * 转换团队数据中的 Prisma 关联字段名
 * 将大写字段名（如 School, TeamMember）转换为小写（如 school, members）
 */
export function transformTeamForFrontend(team: Record<string, unknown>): Record<string, unknown> {
  if (!team) return team

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(team)) {
    // 检查是否是需要转换的字段
    const lowerKey = FIELD_MAPPINGS[key] || key

    // 如果是 TeamMember，特殊处理为 members
    if (key === 'TeamMember' && Array.isArray(value)) {
      result.members = value
    } else if (key === 'School' && value && typeof value === 'object') {
      result.school = value
    } else if (key === 'Student' && value && typeof value === 'object') {
      result.student = value
    } else if (key === 'Teacher' && value && typeof value === 'object') {
      result.teacher = value
    } else if (key === 'Admin' && value && typeof value === 'object') {
      result.admin = value
    } else if (key === 'User' && value && typeof value === 'object') {
      result.user = value
    } else {
      result[lowerKey] = value
    }
  }

  return result
}

/**
 * 批量转换团队数据
 */
export function transformTeamsForFrontend(teams: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return teams.map(transformTeamForFrontend)
}