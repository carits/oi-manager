/**
 * Training Module - Helper Functions
 * 训练模块辅助函数（权限检查、ID 解析）
 */

import { prisma } from '../../prisma'
import { getUserTeacherId } from '../../middleware/permissions'

/** Get participant names in a single query (replaces 3 separate queries) */
export async function getParticipantNames(userIds: string[]): Promise<Map<string, { name: string; username: string }>> {
  if (userIds.length === 0) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      username: true,
      Teacher: { select: { name: true } },
      Student: { select: { name: true } },
    },
  })
  return new Map(users.map(u => [u.id, {
    name: u.Teacher?.name || u.Student?.name || '未知',
    username: u.username,
  }]))
}

/** 获取用户在团队中的成员信息 */
export async function getTeamMember(userId: string, teamId: string) {
  const teacherId = await getUserTeacherId(userId)
  const student = await prisma.student.findUnique({ where: { userId } })

  const orConditions: Array<{ userId: string; userType: string }> = []
  if (teacherId) orConditions.push({ userId: teacherId, userType: 'teacher' })
  if (student) orConditions.push({ userId: student.id, userType: 'student' })

  if (orConditions.length === 0) return null

  return prisma.teamMember.findFirst({
    where: { teamId, OR: orConditions, status: 'active' }
  })
}

/** 检查是否是团队管理员（优化：合并查询，常见路径 1-2 次 DB 查询） */
export async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  // 只有 super_admin 有全局管理员权限
  if (user?.role === 'super_admin') return true

  const teacherId = await getUserTeacherId(userId)
  const student = await prisma.student.findUnique({ where: { userId } })

  const orConditions: Array<{ userId: string; userType: string }> = []
  if (teacherId) orConditions.push({ userId: teacherId, userType: 'teacher' })
  if (student) orConditions.push({ userId: student.id, userType: 'student' })
  if (orConditions.length === 0) return false

  const member = await prisma.teamMember.findFirst({
    where: { teamId, OR: orConditions, status: 'active', role: { in: ['owner', 'admin'] } }
  })
  return !!member
}

/** 检查是否是团队成员 */
export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role === 'super_admin' || user?.role === 'platform_admin') return true

  return !!(await getTeamMember(userId, teamId))
}

/** 获取用户的 userType 用于训练上下文 */
export async function getUserTypeForTeam(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role === 'super_admin' || user?.role === 'platform_admin') return 'teacher'
  if (user?.role === 'teacher' || user?.role === 'school_principal') return 'teacher'
  return 'student'
}

/** 解析训练 ID（数字） */
export function parseTrainingId(raw: string): number {
  const n = parseInt(raw, 10)
  if (isNaN(n)) throw new Error('无效的训练 ID')
  return n
}

/** 检查训练是否已开始（非管理员在 upcoming 时拒绝访问） */
export async function requireTrainingStarted(
  training: { status: string; startTime: Date; endTime: Date },
  userId: string,
  teamId: string,
): Promise<string | null> {
  let status = training.status
  if (status !== 'finished') {
    const now = new Date()
    if (now < training.startTime) status = 'upcoming'
    else if (now <= training.endTime) status = 'ongoing'
    else status = 'finished'
  }
  if (status !== 'upcoming') return null
  if (await isTeamAdmin(userId, teamId)) return null
  return '训练尚未开始'
}
