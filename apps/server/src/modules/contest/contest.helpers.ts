/**
 * Contest Module - Helper Functions
 * 训练模块辅助函数（权限检查、ID 解析）
 */

import { prisma } from '../../prisma'
import { hasOrganizationCapability, hasTeamCapability, organizationRoleFromRoleKeys, resolveOrganizationAuthorization } from '../authorization/capabilities'

/** 按比赛所属组织解析参赛者展示名；不读取旧 Student/Teacher 档案。 */
export async function getParticipantNames(
  userIds: string[],
  organizationId?: string
): Promise<Map<string, { name: string; username: string; avatar: string | null; userType: 'teacher' | 'student' }>> {
  if (userIds.length === 0) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, avatar: true, role: true }
  })
  const userMap = new Map(users.map((user) => [user.id, user]))
  if (!organizationId) {
    return new Map(users.map((user) => [user.id, { name: user.username, username: user.username, avatar: user.avatar, userType: 'student' as const }]))
  }
  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId, userId: { in: userIds }, status: 'active' },
    select: {
      userId: true,
      RoleAssignments: { select: { roleKey: true } },
      StudentProfile: { select: { name: true, avatar: true } },
      TeacherProfile: { select: { name: true, avatar: true } }
    }
  })
  const result = new Map<string, { name: string; username: string; avatar: string | null; userType: 'teacher' | 'student' }>()
  for (const membership of memberships) {
    const user = userMap.get(membership.userId)
    if (!user) continue
    const organizationRole = organizationRoleFromRoleKeys(membership.RoleAssignments.map(item => item.roleKey))
    if (!organizationRole) continue
    const isTeacher = organizationRole === 'teacher' || organizationRole === 'school_principal'
    const profile = isTeacher ? membership.TeacherProfile : membership.StudentProfile
    result.set(user.id, { name: profile?.name || user.username, username: user.username, avatar: user.avatar || profile?.avatar || null, userType: isTeacher ? 'teacher' : 'student' })
  }
  return result
}

/** 获取用户在团队中的成员信息 */
export async function getTeamMember(userId: string, teamId: string) {
  return prisma.teamMember.findFirst({
    where: { teamId, userId, status: 'active' }
  })
}

/** 检查是否是团队管理员 */
export async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  return hasTeamCapability(userId, teamId, 'contest.manage')
}

/** 检查是否是团队成员 */
export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  const [user, team] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.team.findUnique({ where: { id: teamId }, select: { scope: true } }),
  ])
  if (
    team?.scope === 'campus'
    && (user?.role === 'super_admin' || user?.role === 'platform_admin')
  ) return true

  return !!(await getTeamMember(userId, teamId))
}

/** 检查是否是组织比赛管理员（可创建/管理校园比赛）。 */
export async function isOrganizationContestAdmin(userId: string, organizationId: string, contestCreatedBy?: string): Promise<boolean> {
  return hasOrganizationCapability(userId, organizationId, 'contest.manage', {
    resourceCreatedByUserId: contestCreatedBy,
  })
}

/** 检查是否是组织成员（可查看/参加校园比赛）。 */
export async function isOrganizationMember(userId: string, organizationId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!user) return false
  if (user.role === 'super_admin' || user.role === 'platform_admin') return true
  return Boolean(await resolveOrganizationAuthorization(userId, organizationId))
}

/** 训练访问模式：team、organization 或平台公开活动。 */
export type ContestListStatus = 'ongoing' | 'upcoming' | 'finished' | string

export interface ContestListSortItem {
  id: number
  title: string
  status: ContestListStatus
  startTime: string | Date
  createdAt?: string | Date
}

const TRAINING_STATUS_ORDER: Record<string, number> = {
  ongoing: 0,
  upcoming: 1,
  finished: 2,
}

/** 计算训练/比赛当前状态，避免列表排序依赖过期 status 字段。 */
export function getComputedContestStatus(contest: { status: string; startTime: Date; endTime: Date }, now = new Date()): ContestListStatus {
  if (now < contest.startTime) return 'upcoming'
  if (now <= contest.endTime) return 'ongoing'
  return 'finished'
}

function extractContestLevel(title: string): number {
  const match = title.match(/\d+/)
  if (!match) return 0
  const level = Number(match[0])
  return Number.isFinite(level) ? level : 0
}

function timeValue(value: string | Date | undefined): number {
  if (!value) return 0
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

/**
 * 列表展示顺序：进行中优先，其次未开始，最后已结束；同状态按标题中的数字级别降序，
 * 再按开始时间降序兜底。当前 Contest 模型尚无显式 level 字段，数字标题是旧数据的兼容级别来源。
 */
export function sortContestListForDisplay<T extends ContestListSortItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const statusDiff = (TRAINING_STATUS_ORDER[a.status] ?? 99) - (TRAINING_STATUS_ORDER[b.status] ?? 99)
    if (statusDiff !== 0) return statusDiff

    const levelDiff = extractContestLevel(b.title) - extractContestLevel(a.title)
    if (levelDiff !== 0) return levelDiff

    const startDiff = timeValue(b.startTime) - timeValue(a.startTime)
    if (startDiff !== 0) return startDiff

    const createdDiff = timeValue(b.createdAt) - timeValue(a.createdAt)
    if (createdDiff !== 0) return createdDiff

    return b.id - a.id
  })
}

export type ContestAccessMode = 'team' | 'organization' | 'platform' | null

/** 判断比赛的访问模式（基于 teamId/organizationId） */
export function getContestAccessMode(contest: { teamId: string | null; organizationId: string | null; scope?: string }): ContestAccessMode {
  if (contest.teamId) return 'team'
  if (contest.organizationId) return 'organization'
  if (contest.scope === 'platform') return 'platform'
  return null
}

/** 检查用户是否有权限访问比赛（统一入口） */
export async function canAccessContest(
  userId: string,
  contest: { teamId: string | null; organizationId: string | null; scope?: string },
): Promise<boolean> {
  const mode = getContestAccessMode(contest)
  if (mode === 'team') {
    return isTeamMember(userId, contest.teamId!)
  } else if (mode === 'organization') {
    return isOrganizationMember(userId, contest.organizationId!)
  } else if (mode === 'platform') {
    return Boolean(await prisma.user.findFirst({ where: { id: userId, status: 'active' }, select: { id: true } }))
  }
  return false // 无归属的比赛拒绝访问
}

/** 检查用户是否有权限管理比赛（统一入口） */
export async function canManageContest(
  userId: string,
  contest: { teamId: string | null; organizationId: string | null; createdBy: string; scope?: string },
): Promise<boolean> {
  const mode = getContestAccessMode(contest)
  if (mode === 'team') {
    return isTeamAdmin(userId, contest.teamId!)
  } else if (mode === 'organization') {
    return isOrganizationContestAdmin(userId, contest.organizationId!, contest.createdBy)
  } else if (mode === 'platform') {
    const user = await prisma.user.findFirst({ where: { id: userId, status: 'active' }, select: { role: true } })
    return Boolean(user && ['super_admin', 'platform_admin'].includes(user.role))
  }
  return false
}

/** 按比赛所属组织或团队确定用户类型，避免从全局账号角色推断校园身份。 */
export async function getUserTypeForContest(userId: string, contestId: number): Promise<'teacher' | 'student'> {
  const [user, contest] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.contest.findUnique({
      where: { publicId: contestId },
      select: { organizationId: true, teamId: true, Team: { select: { organizationId: true } } },
    }),
  ])
  if (user?.role === 'super_admin' || user?.role === 'platform_admin') return 'teacher'
  if (!contest) return 'student'

  const organizationId = contest.organizationId || contest.Team?.organizationId
  if (organizationId) {
    const membership = await prisma.organizationMembership.findFirst({
      where: { organizationId, userId, status: 'active' },
      select: { RoleAssignments: { select: { roleKey: true } } },
    })
    const organizationRole = membership
      ? organizationRoleFromRoleKeys(membership.RoleAssignments.map(item => item.roleKey))
      : null
    if (organizationRole === 'teacher' || organizationRole === 'school_principal') return 'teacher'
  }
  if (contest.teamId) {
    const teamMember = await prisma.teamMember.findFirst({
      where: { teamId: contest.teamId, userId, status: 'active' },
      select: { userType: true },
    })
    if (teamMember?.userType === 'teacher') return 'teacher'
  }
  return 'student'
}

/** Build immutable contest-problem data from the selected canonical problem revision. */
export function buildContestProblemData(problem: {
  title: string
  description: string | null
  latestTestSetRevisionId?: string | null
  platform: string
  problemId: string
}) {
  return {
    title: problem.title,
    description: problem.description,
    testSetRevisionId: problem.latestTestSetRevisionId || null,
    sourcePlatform: problem.platform,
    sourceProblemId: problem.problemId,
  }
}

/** 解析比赛公开 ID（数字） */
export function parseContestId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new Error('无效的比赛 ID')
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('无效的比赛 ID')
  return n
}

/** 检查比赛是否已开始（非管理员在 upcoming 时拒绝访问） */
export async function requireContestStarted(
  contest: { id: number; status: string; startTime: Date; endTime: Date; teamId: string | null; organizationId: string | null; createdBy: string; scope?: string },
  userId: string,
): Promise<string | null> {
  let status = contest.status
  if (status !== 'finished') {
    const now = new Date()
    if (now < contest.startTime) status = 'upcoming'
    else if (now <= contest.endTime) status = 'ongoing'
    else status = 'finished'
  }
  if (status !== 'upcoming') return null

  // 根据比赛归属判断管理员权限
  const mode = getContestAccessMode(contest)
  if (mode === 'team' && contest.teamId) {
    if (await isTeamAdmin(userId, contest.teamId)) return null
  } else if (mode === 'organization' && contest.organizationId) {
    if (await isOrganizationContestAdmin(userId, contest.organizationId, contest.createdBy)) return null
  } else if (mode === 'platform') {
    if (await canManageContest(userId, contest)) return null
  }
  return '比赛尚未开始'
}
