/**
 * Training Module - Helper Functions
 * 训练模块辅助函数（权限检查、ID 解析）
 */

import { prisma } from '../../prisma'
import { hasOrganizationCapability, hasTeamCapability } from '../authorization/capabilities'

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
      userId: true, memberRole: true,
      StudentProfile: { select: { name: true, avatar: true } },
      TeacherProfile: { select: { name: true, avatar: true } }
    }
  })
  const result = new Map<string, { name: string; username: string; avatar: string | null; userType: 'teacher' | 'student' }>()
  for (const membership of memberships) {
    const user = userMap.get(membership.userId)
    if (!user) continue
    const isTeacher = membership.memberRole === 'teacher' || membership.memberRole === 'school_principal'
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
export async function isOrganizationContestAdmin(userId: string, organizationId: string, trainingCreatedBy?: string): Promise<boolean> {
  return hasOrganizationCapability(userId, organizationId, 'contest.manage', {
    resourceCreatedByUserId: trainingCreatedBy,
  })
}

/** 检查是否是组织成员（可查看/参加校园比赛）。 */
export async function isOrganizationMember(userId: string, organizationId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!user) return false
  if (user.role === 'super_admin' || user.role === 'platform_admin') return true
  return Boolean(await prisma.organizationMembership.findFirst({
    where: { organizationId, userId, status: 'active' },
    select: { id: true },
  }))
}

/** 训练访问模式：team、organization 或平台公开活动。 */
export type TrainingListStatus = 'ongoing' | 'upcoming' | 'finished' | string

export interface TrainingListSortItem {
  id: number
  title: string
  status: TrainingListStatus
  startTime: string | Date
  createdAt?: string | Date
}

const TRAINING_STATUS_ORDER: Record<string, number> = {
  ongoing: 0,
  upcoming: 1,
  finished: 2,
}

/** 计算训练/比赛当前状态，避免列表排序依赖过期 status 字段。 */
export function getComputedTrainingStatus(training: { status: string; startTime: Date; endTime: Date }, now = new Date()): TrainingListStatus {
  if (now < training.startTime) return 'upcoming'
  if (now <= training.endTime) return 'ongoing'
  return 'finished'
}

function extractTrainingLevel(title: string): number {
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
 * 再按开始时间降序兜底。当前 Training 模型尚无显式 level 字段，数字标题是旧数据的兼容级别来源。
 */
export function sortTrainingListForDisplay<T extends TrainingListSortItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const statusDiff = (TRAINING_STATUS_ORDER[a.status] ?? 99) - (TRAINING_STATUS_ORDER[b.status] ?? 99)
    if (statusDiff !== 0) return statusDiff

    const levelDiff = extractTrainingLevel(b.title) - extractTrainingLevel(a.title)
    if (levelDiff !== 0) return levelDiff

    const startDiff = timeValue(b.startTime) - timeValue(a.startTime)
    if (startDiff !== 0) return startDiff

    const createdDiff = timeValue(b.createdAt) - timeValue(a.createdAt)
    if (createdDiff !== 0) return createdDiff

    return b.id - a.id
  })
}

export type TrainingAccessMode = 'team' | 'organization' | 'platform' | null

/** 判断训练的访问模式（基于 teamId/organizationId） */
export function getTrainingAccessMode(training: { teamId: string | null; organizationId: string | null; scope?: string }): TrainingAccessMode {
  if (training.teamId) return 'team'
  if (training.organizationId) return 'organization'
  if (training.scope === 'platform') return 'platform'
  return null
}

/** 检查用户是否有权限访问训练（统一入口） */
export async function canAccessTraining(
  userId: string,
  training: { teamId: string | null; organizationId: string | null; scope?: string },
): Promise<boolean> {
  const mode = getTrainingAccessMode(training)
  if (mode === 'team') {
    return isTeamMember(userId, training.teamId!)
  } else if (mode === 'organization') {
    return isOrganizationMember(userId, training.organizationId!)
  } else if (mode === 'platform') {
    return Boolean(await prisma.user.findFirst({ where: { id: userId, status: 'active' }, select: { id: true } }))
  }
  return false // 无归属的训练拒绝访问
}

/** 检查用户是否有权限管理训练（统一入口） */
export async function canManageTraining(
  userId: string,
  training: { teamId: string | null; organizationId: string | null; createdBy: string; scope?: string },
): Promise<boolean> {
  const mode = getTrainingAccessMode(training)
  if (mode === 'team') {
    return isTeamAdmin(userId, training.teamId!)
  } else if (mode === 'organization') {
    return isOrganizationContestAdmin(userId, training.organizationId!, training.createdBy)
  } else if (mode === 'platform') {
    const user = await prisma.user.findFirst({ where: { id: userId, status: 'active' }, select: { role: true } })
    return Boolean(user && ['super_admin', 'platform_admin'].includes(user.role))
  }
  return false
}

/** 获取用户的 userType 用于训练上下文 */
export async function getUserTypeForTeam(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (user?.role === 'super_admin' || user?.role === 'platform_admin') return 'teacher'
  if (user?.role === 'teacher' || user?.role === 'school_principal') return 'teacher'
  return 'student'
}

/** 从 Problem 生成快照数据，供 TrainingProblem 创建时使用 */
export function populateSnapshotData(problem: {
  title: string
  description: string | null
  timeLimit: number | null
  memoryLimit: number | null
  judgeConfig: string | null
  testGraphRevision?: number
  latestTestSetRevisionId?: string | null
  LatestTestSetRevision?: { judgeConfig: string; revisionNumber: number } | null
  allowedLanguages: string | null
  platform: string
  problemId: string
  ProblemStatement?: { content: string | null; isVisible: boolean }[]
}) {
  const statements = problem.ProblemStatement?.filter(s => s.isVisible).map(s => s.content).filter((c): c is string => c !== null) || []
  return {
    titleSnapshot: problem.title,
    statementSnapshot: problem.description,
    statementsSnapshotJson: statements.length > 0 ? JSON.stringify(statements) : null,
    timeLimitSnapshot: problem.timeLimit,
    memoryLimitSnapshot: problem.memoryLimit,
    judgeConfigSnapshot: problem.LatestTestSetRevision?.judgeConfig || problem.judgeConfig,
    testGraphRevisionSnapshot: problem.testGraphRevision ?? 0,
    testSetRevisionId: problem.latestTestSetRevisionId || null,
    allowedLanguagesSnapshot: problem.allowedLanguages,
    sourcePlatformSnapshot: problem.platform,
    sourceProblemIdSnapshot: problem.problemId,
    sourceUrlSnapshot: null,
    snapshotCreatedAt: new Date(),
    dataVersion: problem.latestTestSetRevisionId ? '2' : '1',
  }
}

/** 解析训练 ID（数字） */
export function parseTrainingId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new Error('无效的训练 ID')
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('无效的训练 ID')
  return n
}

/** 检查训练是否已开始（非管理员在 upcoming 时拒绝访问） */
export async function requireTrainingStarted(
  training: { id: number; status: string; startTime: Date; endTime: Date; teamId: string | null; organizationId: string | null; createdBy: string; scope?: string },
  userId: string,
): Promise<string | null> {
  let status = training.status
  if (status !== 'finished') {
    const now = new Date()
    if (now < training.startTime) status = 'upcoming'
    else if (now <= training.endTime) status = 'ongoing'
    else status = 'finished'
  }
  if (status !== 'upcoming') return null

  // 根据训练归属判断管理员权限
  const mode = getTrainingAccessMode(training)
  if (mode === 'team' && training.teamId) {
    if (await isTeamAdmin(userId, training.teamId)) return null
  } else if (mode === 'organization' && training.organizationId) {
    if (await isOrganizationContestAdmin(userId, training.organizationId, training.createdBy)) return null
  } else if (mode === 'platform') {
    if (await canManageTraining(userId, training)) return null
  }
  return '训练尚未开始'
}
