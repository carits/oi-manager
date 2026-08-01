/**
 * Team Module - Utility Functions
 * 团队模块工具函数
 */

import { prisma } from '../../prisma'
import type { MemberType, MemberDetails, TeamScope } from './team.types'

/**
 * 根据 userId 和 userType 获取用户名称
 */
export async function getUserName(userId: string, userType: MemberType): Promise<string> {
  if (userType === 'user') {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true }
    })
    return user?.username || '未知'
  }
  if (userType === 'teacher') {
    const teacher = await prisma.teacher.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatar: true, title: true }
    })
    return teacher?.name || '未知'
  } else {
    const student = await prisma.student.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatar: true, rating: true, enrollmentYear: true }
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

  if (userType === 'user') {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, status: 'active' },
      select: { id: true, username: true }
    })
    return new Map(users.map(user => [user.id, user.username]))
  }

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
  if (userType === 'user') {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, avatar: true, status: true }
    })
    if (!user || user.status !== 'active') return null
    return {
      id: user.id,
      name: user.username,
      username: user.username,
      avatar: user.avatar,
      type: 'user'
    }
  }
  if (userType === 'teacher') {
    const teacher = await prisma.teacher.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatar: true, title: true }
    })
    if (!teacher) return null

    const user = await prisma.user.findUnique({
      where: { id: teacher.id },
      select: { username: true, avatar: true }
    })

    // 优先使用 User 表的头像（用户上传头像时更新的是 User 表）
    return {
      id: teacher.id,
      name: teacher.name,
      avatar: user?.avatar || teacher.avatar,
      username: user?.username || '',
      type: 'teacher',
      title: teacher.title || undefined
    }
  } else {
    const student = await prisma.student.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatar: true, rating: true, enrollmentYear: true }
    })
    if (!student) return null

    const user = await prisma.user.findUnique({
      where: { id: student.id },
      select: { username: true, avatar: true }
    })

    // 优先使用 User 表的头像（用户上传头像时更新的是 User 表）
    return {
      id: student.id,
      name: student.name,
      avatar: user?.avatar || student.avatar,
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
  const userIds = members.filter(m => m.userType === 'user').map(m => m.userId)
  const teacherIds = members.filter(m => m.userType === 'teacher').map(m => m.userId)
  const studentIds = members.filter(m => m.userType === 'student').map(m => m.userId)

  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, status: 'active' },
      select: { id: true, username: true, avatar: true }
    })
    for (const user of users) {
      result.set(`user:${user.id}`, {
        id: user.id,
        name: user.username,
        username: user.username,
        avatar: user.avatar,
        type: 'user'
      })
    }
  }

  // 批量查询教师
  if (teacherIds.length > 0) {
    const teachers = await prisma.teacher.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true, name: true, avatar: true, title: true }
    })

    const teacherUsers = await prisma.user.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true, username: true, avatar: true }
    })
    const teacherUserMap = new Map(teacherUsers.map(u => [u.id, u]))

    for (const teacher of teachers) {
      const user = teacherUserMap.get(teacher.id)
      result.set(`teacher:${teacher.id}`, {
        id: teacher.id,
        name: teacher.name,
        avatar: user?.avatar || teacher.avatar,
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
      select: { id: true, name: true, avatar: true, rating: true, enrollmentYear: true }
    })

    const studentUsers = await prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, username: true, avatar: true }
    })
    const studentUserMap = new Map(studentUsers.map(u => [u.id, u]))

    for (const student of students) {
      const user = studentUserMap.get(student.id)
      result.set(`student:${student.id}`, {
        id: student.id,
        name: student.name,
        avatar: user?.avatar || student.avatar,
        username: user?.username || '',
        type: 'student',
        rating: student.rating || undefined,
        enrollmentYear: student.enrollmentYear || undefined
      })
    }
  }

  return result
}

export async function getUserDisplayName(
  userId: string,
  userType: MemberType,
  scope: TeamScope
): Promise<string> {
  if (scope === 'campus') return getUserName(userId, userType)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true }
  })
  return user?.username || '未知'
}

/**
 * 个人模式只暴露平台用户名；校园模式保留实名。
 */
export function formatMemberForScope<T extends MemberDetails>(
  member: T,
  scope: TeamScope
): T {
  if (scope !== 'personal') return member
  return {
    ...member,
    name: member.username || member.name
  }
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
    if (team.scope === 'personal' && key === 'schoolId') {
      continue
    } else if (key === 'TeamMember' && Array.isArray(value)) {
      result.members = value
    } else if (key === 'School' && team.scope === 'personal') {
      continue
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
