/**
 * Training Module - Helper Functions
 * 训练模块辅助函数（权限检查、ID 解析）
 */

import { prisma } from '../../prisma'

/** Get participant names in a single query (replaces 3 separate queries) */
export async function getParticipantNames(userIds: string[]): Promise<Map<string, { name: string; username: string; avatar: string | null; userType: 'teacher' | 'student' }>> {
  if (userIds.length === 0) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      username: true,
      avatar: true,
      role: true,
      Teacher: { select: { name: true } },
      Student: { select: { name: true } },
    },
  })
  return new Map(users.map(u => [u.id, {
    name: u.Teacher?.name || u.Student?.name || '未知',
    username: u.username,
    avatar: u.avatar,
    userType: u.role === 'teacher' || u.role === 'school_principal' || u.role === 'platform_admin' || u.role === 'super_admin' ? 'teacher' : 'student',
  }]))
}

/** 获取用户在团队中的成员信息 */
export async function getTeamMember(userId: string, teamId: string) {
  return prisma.teamMember.findFirst({
    where: { teamId, userId, status: 'active' }
  })
}

/** 检查是否是团队管理员 */
export async function isTeamAdmin(userId: string, teamId: string): Promise<boolean> {
  const [user, team] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.team.findUnique({ where: { id: teamId }, select: { scope: true } }),
  ])
  if (team?.scope === 'campus' && user?.role === 'super_admin') return true

  const member = await prisma.teamMember.findFirst({
    where: { teamId, userId, status: 'active', role: { in: ['owner', 'admin'] } }
  })
  return !!member
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

/** 检查是否是学校比赛管理员（可创建/管理校级比赛） */
export async function isSchoolContestAdmin(userId: string, schoolId: string, trainingCreatedBy?: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, schoolId: true } })
  if (!user) return false
  if (user.role === 'super_admin') return true
  // 学校负责人可以管理本校所有校级比赛
  if (user.role === 'school_principal' && user.schoolId === schoolId) return true
  // 普通教师可以创建校级比赛，只能管理自己创建的比赛
  if ((user.role === 'teacher' || user.role === 'school_principal') && user.schoolId === schoolId) {
    // 创建权限：只要是本校教师即可
    if (!trainingCreatedBy) return true
    // 管理权限：只能管理自己创建的，或者自己是学校负责人
    if (user.role === 'school_principal') return true
    return trainingCreatedBy === userId
  }
  return false
}

/** 检查是否是学校成员（可查看/参加校级比赛） */
export async function isSchoolMember(userId: string, schoolId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, schoolId: true } })
  if (!user) return false
  if (user.role === 'super_admin' || user.role === 'platform_admin') return true
  return user.schoolId === schoolId
}

/** 训练访问模式：team 或 school */
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
  if (training.status === 'finished') return 'finished'
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

export type TrainingAccessMode = 'team' | 'school' | null

/** 判断训练的访问模式（基于 teamId/schoolId） */
export function getTrainingAccessMode(training: { teamId: string | null; schoolId: string | null }): TrainingAccessMode {
  if (training.teamId) return 'team'
  if (training.schoolId) return 'school'
  return null
}

/** 检查用户是否有权限访问训练（统一入口） */
export async function canAccessTraining(
  userId: string,
  training: { teamId: string | null; schoolId: string | null },
): Promise<boolean> {
  const mode = getTrainingAccessMode(training)
  if (mode === 'team') {
    return isTeamMember(userId, training.teamId!)
  } else if (mode === 'school') {
    return isSchoolMember(userId, training.schoolId!)
  }
  return false // 无归属的训练拒绝访问
}

/** 检查用户是否有权限管理训练（统一入口） */
export async function canManageTraining(
  userId: string,
  training: { teamId: string | null; schoolId: string | null; createdBy: string },
): Promise<boolean> {
  const mode = getTrainingAccessMode(training)
  if (mode === 'team') {
    return isTeamAdmin(userId, training.teamId!)
  } else if (mode === 'school') {
    return isSchoolContestAdmin(userId, training.schoolId!, training.createdBy)
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
    judgeConfigSnapshot: problem.judgeConfig,
    allowedLanguagesSnapshot: problem.allowedLanguages,
    sourcePlatformSnapshot: problem.platform,
    sourceProblemIdSnapshot: problem.problemId,
    sourceUrlSnapshot: null,
    snapshotCreatedAt: new Date(),
    dataVersion: '1',
  }
}

/** 解析训练 ID（数字） */
export function parseTrainingId(raw: string): number {
  const n = parseInt(raw, 10)
  if (isNaN(n)) throw new Error('无效的训练 ID')
  return n
}

/** 检查训练是否已开始（非管理员在 upcoming 时拒绝访问） */
export async function requireTrainingStarted(
  training: { id: number; status: string; startTime: Date; endTime: Date; teamId: string | null; schoolId: string | null; createdBy: string },
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
  } else if (mode === 'school' && training.schoolId) {
    if (await isSchoolContestAdmin(userId, training.schoolId, training.createdBy)) return null
  }
  return '训练尚未开始'
}
