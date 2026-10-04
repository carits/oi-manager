import type { Prisma, TrainingEngineSessionStatus, TrainingEngineTargetType } from '@prisma/client'
import { prisma } from '../../prisma'
import { isOrganizationContestAdmin, isOrganizationMember, isTeamAdmin, isTeamMember } from './training-auth.service'
import { createQueuedSubmissionWithRun } from '../judge/application/judge-run.service'
import { normalizeSubmissionIo } from '../judge/domain/submission-io'
import { eligibleTrainingParticipantIds, validateTrainingParticipantTarget } from './application/training-roster.service'
import { TrainingEngineError } from './training-engine.errors'
import {
  reconcileParticipantCurrentProblem,
  resolveEffectiveSessionProblems,
} from './training-effective-problems.service'

export { TrainingEngineError } from './training-engine.errors'

type TrainingRequestIdentity = { accountRole?: string | null; organizationId?: string | null }

const problemSelect = {
  id: true,
  platform: true,
  problemId: true,
  title: true,
  difficulty: true,
  timeLimit: true,
  memoryLimit: true,
} satisfies Prisma.ProblemSelect

const problemInclude = { Problem: { select: problemSelect } } satisfies Prisma.TrainingSessionProblemInclude

function boundedText(value: unknown, max: number, field: string, min = 0) {
  const text = String(value ?? '').trim()
  if (text.length < min || text.length > max) throw new TrainingEngineError(422, 'INVALID_TRAINING_SESSION', `${field}长度必须为 ${min}～${max} 个字符`)
  return text
}

function boundedInteger(value: unknown, min: number, max: number, field: string) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) throw new TrainingEngineError(422, 'INVALID_TRAINING_SESSION', `${field}必须为 ${min}～${max} 的整数`)
  return number
}

function optionalDate(value: unknown, field: string) {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(String(value))
  if (!Number.isFinite(date.getTime())) throw new TrainingEngineError(422, 'INVALID_TRAINING_SESSION', `${field}不是合法时间`)
  return date
}

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function isAccepted(result: unknown) {
  return ['accepted', 'ac'].includes(String(result || '').trim().toLowerCase())
}

function runningElapsed(value: { activeElapsedSeconds: number; runningSince?: Date | null }, now = new Date()) {
  return value.activeElapsedSeconds + (value.runningSince ? Math.max(0, Math.floor((now.getTime() - value.runningSince.getTime()) / 1000)) : 0)
}

export function assertTrainingSubmissionWindow(session: {
  status: TrainingEngineSessionStatus
  currentRoundId: string | null
  totalDurationSeconds: number
  activeElapsedSeconds: number
  runningSince?: Date | null
  Rounds: Array<{ id: string; lifecycle: string; timeLimitSeconds?: number | null; activeElapsedSeconds: number; runningSince?: Date | null }>
}, now = new Date()) {
  if (session.status !== 'RUNNING' || !session.currentRoundId) throw new TrainingEngineError(409, 'TRAINING_SESSION_NOT_RUNNING', '只有进行中的训练可以提交')
  if (runningElapsed(session, now) >= session.totalDurationSeconds) throw new TrainingEngineError(409, 'TRAINING_SESSION_TIME_REACHED', '训练时间已结束，不能继续提交')
  const round = session.Rounds.find(item => item.id === session.currentRoundId)
  if (!round || round.lifecycle !== 'RUNNING') throw new TrainingEngineError(409, 'TRAINING_ROUND_NOT_RUNNING', '当前轮次已结束，不能继续提交')
  if (round.timeLimitSeconds != null && runningElapsed(round, now) >= round.timeLimitSeconds) throw new TrainingEngineError(409, 'TRAINING_ROUND_TIME_REACHED', '本轮时间已结束，不能继续提交')
}

function isGlobalTrainingRequest(identity: TrainingRequestIdentity) {
  return identity.accountRole === 'platform_admin' || identity.accountRole === 'super_admin'
}

async function globalRole(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } })
}

export async function canManageSession(userId: string, session: { teamId: string | null; organizationId: string | null; createdBy: string }) {
  const user = await globalRole(userId)
  if (!user || user.status !== 'active') return false
  if (['super_admin', 'platform_admin'].includes(user.role)) return true
  if (session.createdBy === userId) return true
  if (session.teamId) return isTeamAdmin(userId, session.teamId)
  if (session.organizationId) return isOrganizationContestAdmin(userId, session.organizationId, session.createdBy)
  return false
}

export async function canAccessSession(userId: string, session: { id: string; teamId: string | null; organizationId: string | null; createdBy: string; status: TrainingEngineSessionStatus }) {
  if (await canManageSession(userId, session)) return true
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId: session.id, userId } }, select: { status: true } })
  return participant?.status === 'active'
}

async function assertScopeManagement(userId: string, input: { organizationId?: string | null; teamId?: string | null }) {
  const organizationId = input.organizationId ? String(input.organizationId) : null
  const teamId = input.teamId ? String(input.teamId) : null
  if (Boolean(organizationId) === Boolean(teamId)) throw new TrainingEngineError(422, 'TRAINING_SESSION_SCOPE_REQUIRED', '必须且只能选择一个学校或团队范围')
  if (teamId && !await isTeamAdmin(userId, teamId)) throw new TrainingEngineError(403, 'TRAINING_SESSION_FORBIDDEN', '需要团队管理员权限')
  if (organizationId && !await isOrganizationContestAdmin(userId, organizationId)) throw new TrainingEngineError(403, 'TRAINING_SESSION_FORBIDDEN', '需要学校训练管理权限')
  return { organizationId, teamId }
}

export async function assertTrainingScopeContextForUser(identity: TrainingRequestIdentity, scope: { organizationId?: string | null; teamId?: string | null }) {
  if (isGlobalTrainingRequest(identity)) return
  const organizationId = scope.organizationId ? String(scope.organizationId) : null
  const teamId = scope.teamId ? String(scope.teamId) : null
  if (organizationId && identity.organizationId !== organizationId) throw new TrainingEngineError(403, 'TRAINING_SCOPE_CONTEXT_MISMATCH', '训练范围不属于当前学校上下文')
  if (!teamId) return
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { scope: true, organizationId: true } })
  if (!team) throw new TrainingEngineError(404, 'TRAINING_TEAM_NOT_FOUND', '训练团队不存在')
  if (team.scope === 'campus' && team.organizationId !== identity.organizationId) throw new TrainingEngineError(403, 'TRAINING_SCOPE_CONTEXT_MISMATCH', '训练团队不属于当前学校上下文')
  if (team.scope !== 'campus' && identity.organizationId) throw new TrainingEngineError(403, 'TRAINING_SCOPE_CONTEXT_MISMATCH', '个人团队不能在学校上下文使用')
}

export async function assertTrainingSessionContextForUser(identity: TrainingRequestIdentity, sessionId: string) {
  if (isGlobalTrainingRequest(identity)) return
  const session = await prisma.trainingSession.findUnique({ where: { id: sessionId }, select: { organizationId: true, Team: { select: { scope: true, organizationId: true } } } })
  if (!session) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  if (session.organizationId && session.organizationId !== identity.organizationId) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  if (session.Team?.scope === 'campus' && session.Team.organizationId !== identity.organizationId) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  if (session.Team && session.Team.scope !== 'campus' && identity.organizationId) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
}

export async function loadSession(id: string) {
  return prisma.trainingSession.findUnique({
    where: { id },
    include: {
      Problems: { orderBy: { createdAt: 'asc' }, include: problemInclude },
      Rounds: { orderBy: { orderIndex: 'asc' }, include: { Assignments: { where: { active: true }, orderBy: [{ groupId: 'asc' }, { orderIndex: 'asc' }], include: { SessionProblem: { include: problemInclude } } } } },
      Groups: { where: { status: 'active' }, orderBy: { orderIndex: 'asc' }, include: { Participants: { where: { status: 'active' }, select: { id: true, userId: true, status: true } } } },
      Overlays: { where: { status: 'active' }, orderBy: { startedAt: 'asc' } },
      Team: { select: { name: true, scope: true, organizationId: true } },
    },
  })
}

async function assertManage(userId: string, sessionId: string) {
  const session = await loadSession(sessionId)
  if (!session) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  if (!await canManageSession(userId, session)) throw new TrainingEngineError(403, 'TRAINING_SESSION_FORBIDDEN', '无权管理该训练场次')
  return session
}

async function assertAccess(userId: string, sessionId: string) {
  const session = await loadSession(sessionId)
  if (!session) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  if (!await canAccessSession(userId, session)) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  return session
}

function assertRevision(actual: number, expected: unknown) {
  if (actual !== Number(expected)) throw new TrainingEngineError(409, 'TRAINING_REVISION_CONFLICT', '训练已在其他页面更新，请刷新后重试')
}

async function lockTrainingSession(tx: Prisma.TransactionClient, sessionId: string, expectedRevision?: unknown) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
  const session = await tx.trainingSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  if (expectedRevision !== undefined) assertRevision(session.statusRevision, expectedRevision)
  return session
}

async function appendEvent(tx: Prisma.TransactionClient, sessionId: string, type: string, targetType: TrainingEngineTargetType = 'ALL', targetId: string | null = null, payload?: unknown) {
  const sequence = await tx.trainingSession.update({ where: { id: sessionId }, data: { eventSeq: { increment: 1 } }, select: { eventSeq: true } })
  return tx.trainingSessionEvent.create({ data: { sessionId, seq: sequence.eventSeq, type, targetType, targetId, payload: asJson(payload), expiresAt: new Date(Date.now() + 14 * 24 * 3600_000) } })
}

async function upsertSessionProblems(tx: Prisma.TransactionClient, sessionId: string, references: Array<{ problemId: string; alias?: string | null }>) {
  const unique = [...new Map(references.map(item => [String(item.problemId), item])).values()]
  const problems = await tx.problem.findMany({
    where: { id: { in: unique.map(item => item.problemId) }, status: 'published' },
    select: { ...problemSelect, ProblemStatement: { where: { isVisible: true }, select: { type: true, format: true, language: true, content: true, fileUrl: true } } },
  })
  if (problems.length !== unique.length) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_UNAVAILABLE', '题目不存在、未发布或不可用于训练')
  const byId = new Map(problems.map(problem => [problem.id, problem]))
  const result = []
  for (const reference of unique) {
    const problem = byId.get(reference.problemId)!
    result.push(await tx.trainingSessionProblem.upsert({
      where: { sessionId_problemId: { sessionId, problemId: problem.id } },
      update: { alias: reference.alias?.trim() || null, titleSnapshot: problem.title, statementsSnapshot: asJson(problem.ProblemStatement) },
      create: { sessionId, problemId: problem.id, alias: reference.alias?.trim() || null, titleSnapshot: problem.title, statementsSnapshot: asJson(problem.ProblemStatement) },
      include: problemInclude,
    }))
  }
  return result
}

function summary(session: any) {
  return {
    id: session.id,
    title: session.title,
    description: session.description,
    status: session.status,
    sessionType: session.sessionType,
    statusRevision: session.statusRevision,
    totalDurationSeconds: session.totalDurationSeconds,
    activeElapsedSeconds: session.activeElapsedSeconds,
    scheduledStartAt: session.scheduledStartAt,
    startedAt: session.startedAt,
    runningSince: session.runningSince,
    endedAt: session.endedAt,
    currentRoundId: session.currentRoundId,
    problemCount: session._count?.Problems ?? session.Problems?.length ?? 0,
    participantCount: session._count?.Participants ?? session.Participants?.length ?? 0,
    teamId: session.teamId,
    teamName: session.Team?.name || null,
    createdAt: session.createdAt,
  }
}

export async function previewTrainingParticipants(userId: string, body: any) {
  const scope = await assertScopeManagement(userId, body)
  const requested: string[] = Array.isArray(body?.participantUserIds) ? body.participantUserIds.map(String) : []
  const target = await validateTrainingParticipantTarget(userId, scope, body?.participantTarget, requested)
  const eligible = await eligibleTrainingParticipantIds(scope)
  const participantIds = target === 'custom_students' ? requested : eligible
  const targetName = target === 'organization_students' ? '全校有效学生' : target === 'custom_students' ? '自定义学生' : (await prisma.team.findUnique({ where: { id: scope.teamId! }, select: { name: true } }))?.name || '团队学生'
  return { participantCount: new Set(participantIds).size, targetName }
}

export async function createTrainingSession(userId: string, body: any) {
  const scope = await assertScopeManagement(userId, body)
  const title = boundedText(body?.title, 200, '训练名称', 1)
  const description = body?.description ? boundedText(body.description, 5000, '训练说明') : null
  const sessionType = String(body?.sessionType || 'GENERAL').toUpperCase()
  if (!['GENERAL', 'OI', 'ACM'].includes(sessionType)) throw new TrainingEngineError(422, 'INVALID_TRAINING_SESSION_TYPE', '训练赛制只支持 GENERAL、OI 或 ACM')
  const totalDurationSeconds = boundedInteger(body?.totalDurationSeconds, 300, 7 * 24 * 3600, '训练总时长')
  const scheduledStartAt = optionalDate(body?.scheduledStartAt, '计划开始时间')
  const requested: string[] = Array.isArray(body?.participantUserIds) ? [...new Set<string>(body.participantUserIds.map((value: unknown) => String(value)))] : []
  const target = await validateTrainingParticipantTarget(userId, scope, body?.participantTarget, requested)
  const participantIds = target === 'custom_students' ? requested : await eligibleTrainingParticipantIds(scope)
  if (!participantIds.length) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_REQUIRED', '训练至少需要一名学生')
  const references = Array.isArray(body?.problems) ? body.problems : []
  if (!references.length) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_REQUIRED', '训练至少需要一道题')

  const inputGroups = Array.isArray(body?.grouping?.groups) && body.grouping.groups.length
    ? body.grouping.groups
    : [{ name: '全班', participantIds, problemIds: references.map((item: any) => String(item.problemId)) }]
  const assigned = new Set<string>()
  for (const group of inputGroups) {
    for (const rawParticipantId of group.participantIds || []) {
      const participantId = String(rawParticipantId)
      if (!participantIds.includes(participantId)) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_OUT_OF_SCOPE', '分组中包含训练名单之外的学生')
      if (assigned.has(participantId)) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_DUPLICATED', '同一学生不能同时属于多个训练组')
      assigned.add(participantId)
    }
  }
  const missing = participantIds.filter(id => !assigned.has(id))
  if (missing.length) inputGroups[0].participantIds = [...(inputGroups[0].participantIds || []), ...missing]

  const sessionId = await prisma.$transaction(async tx => {
    const created = await tx.trainingSession.create({ data: { title, description, sessionType: sessionType as any, status: 'READY', organizationId: scope.organizationId, teamId: scope.teamId, createdBy: userId, scheduledStartAt, totalDurationSeconds } })
    const groups = []
    for (let index = 0; index < inputGroups.length; index++) {
      groups.push(await tx.trainingSessionGroup.create({ data: { sessionId: created.id, name: boundedText(inputGroups[index].name, 100, '分组名称', 1), orderIndex: index } }))
    }
    for (let groupIndex = 0; groupIndex < inputGroups.length; groupIndex++) {
      for (const participantId of inputGroups[groupIndex].participantIds || []) await tx.trainingSessionParticipant.create({ data: { sessionId: created.id, userId: String(participantId), groupId: groups[groupIndex].id } })
    }
    const sessionProblems = await upsertSessionProblems(tx, created.id, references)
    const byCanonical = new Map(sessionProblems.map(problem => [problem.problemId, problem]))
    const firstRound = await tx.trainingSessionRound.create({ data: { sessionId: created.id, name: '第一轮', orderIndex: 0 } })
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const requestedIds = inputGroups[groupIndex].problemIds?.length ? inputGroups[groupIndex].problemIds.map(String) : references.map((item: any) => String(item.problemId))
      for (let orderIndex = 0; orderIndex < requestedIds.length; orderIndex++) {
        const sessionProblem = byCanonical.get(requestedIds[orderIndex])
        if (!sessionProblem) throw new TrainingEngineError(422, 'TRAINING_GROUP_PROBLEM_INVALID', '分组题目不在本次训练题目中')
        await tx.trainingRoundProblemAssignment.create({ data: { roundId: firstRound.id, groupId: groups[groupIndex].id, sessionProblemId: sessionProblem.id, orderIndex } })
      }
    }
    if (body?.startImmediately) {
      const now = new Date()
      await tx.trainingSessionRound.update({ where: { id: firstRound.id }, data: { lifecycle: 'RUNNING', startedAt: now, runningSince: now } })
      await tx.trainingSession.update({ where: { id: created.id }, data: { status: 'RUNNING', currentRoundId: firstRound.id, startedAt: now, runningSince: now, statusRevision: { increment: 1 } } })
      await appendEvent(tx, created.id, 'SESSION_STARTED', 'ALL', null, { roundId: firstRound.id })
    }
    return created.id
  })
  const created = await prisma.trainingSession.findUniqueOrThrow({ where: { id: sessionId }, include: { Team: { select: { name: true } }, _count: { select: { Problems: true, Participants: true } } } })
  return summary(created)
}

export async function listTrainingSessions(userId: string, query: any, activeOrganizationId?: string | null) {
  const page = Math.max(1, Number(query?.page || 1))
  const pageSize = Math.min(100, Math.max(1, Number(query?.pageSize || 20)))
  const organizationId = query?.organizationId ? String(query.organizationId) : null
  const teamId = query?.teamId ? String(query.teamId) : null
  if (organizationId && !await isOrganizationMember(userId, organizationId)) throw new TrainingEngineError(404, 'TRAINING_SCOPE_NOT_FOUND', '训练范围不存在')
  if (teamId && !await isTeamMember(userId, teamId)) throw new TrainingEngineError(404, 'TRAINING_SCOPE_NOT_FOUND', '训练范围不存在')
  const statusGroup = String(query?.statusGroup || '')
  const statuses = statusGroup === 'active' ? ['RUNNING', 'PAUSED'] : statusGroup === 'upcoming' ? ['READY'] : statusGroup === 'completed' ? ['ENDED', 'ARCHIVED'] : undefined
  const where: Prisma.TrainingSessionWhereInput = {
    ...(organizationId ? { organizationId } : teamId ? { teamId } : activeOrganizationId ? { organizationId: activeOrganizationId } : {}),
    ...(statuses ? { status: { in: statuses as TrainingEngineSessionStatus[] } } : {}),
    ...(query?.keyword ? { title: { contains: String(query.keyword), mode: 'insensitive' } } : {}),
    OR: [{ createdBy: userId }, { Participants: { some: { userId, status: 'active' } } }],
  }
  const [items, total, counts] = await Promise.all([
    prisma.trainingSession.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { Team: { select: { name: true } }, _count: { select: { Problems: true, Participants: true } } } }),
    prisma.trainingSession.count({ where }),
    prisma.trainingSession.groupBy({ by: ['status'], where: { ...where, status: undefined }, _count: { _all: true } }),
  ])
  return { items: items.map(summary), statusCounts: Object.fromEntries(counts.map(item => [item.status, item._count._all])), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } }
}

async function participantDisplayNames(session: { organizationId: string | null }, userIds: string[]) {
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, avatar: true } })
  const profileByUser = new Map<string, string>()
  if (session.organizationId) {
    const memberships = await prisma.organizationMembership.findMany({ where: { organizationId: session.organizationId, userId: { in: userIds } }, select: { userId: true, StudentProfile: { select: { name: true } }, TeacherProfile: { select: { name: true } } } })
    for (const membership of memberships) {
      const name = membership.StudentProfile?.name || membership.TeacherProfile?.name
      if (name) profileByUser.set(membership.userId, name)
    }
  }
  return new Map(users.map(user => [user.id, { id: user.id, username: user.username, displayName: profileByUser.get(user.id) || user.username, avatar: user.avatar }]))
}

export async function getTrainingWorkspace(userId: string, sessionId: string) {
  const session = await assertAccess(userId, sessionId)
  const manager = await canManageSession(userId, session)
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  const effectiveProblems = manager
    ? session.currentRoundId
      ? [...new Map(session.Rounds.find(round => round.id === session.currentRoundId)?.Assignments.map(assignment => [assignment.SessionProblem.id, assignment.SessionProblem]) || []).values()]
      : []
    : participant ? await resolveEffectiveSessionProblems(sessionId, participant.id) : []
  const visibleIds = new Set(effectiveProblems.map(problem => problem.id))
  const progress = participant ? await prisma.trainingSessionProblemProgress.findMany({ where: { participantId: participant.id, sessionProblemId: { in: [...visibleIds] } }, orderBy: { updatedAt: 'desc' } }) : []
  const currentRound = session.currentRoundId ? session.Rounds.find(round => round.id === session.currentRoundId) || null : null
  const visibleRounds = manager ? session.Rounds : currentRound ? [currentRound] : []
  const permissions = Object.fromEntries(effectiveProblems.map(problem => [problem.id, { canView: true, canSubmit: session.status === 'RUNNING', canEdit: session.status === 'RUNNING', reason: session.status === 'RUNNING' ? 'ALLOWED' : session.status === 'PAUSED' ? 'SESSION_PAUSED' : 'SESSION_NOT_RUNNING' }]))
  return {
    session: { ...summary(session), organizationId: session.organizationId, createdBy: session.createdBy, Problems: manager ? session.Problems : effectiveProblems, Rounds: visibleRounds, Groups: manager ? session.Groups : session.Groups.filter(group => group.id === participant?.groupId), Overlays: session.Overlays, currentRound, activeElapsedSeconds: runningElapsed(session) },
    manager,
    participant: participant ? { id: participant.id, userId: participant.userId, currentGroupId: participant.groupId, currentSessionProblemId: participant.currentSessionProblemId } : null,
    effectiveProblems,
    progress,
    permissions,
  }
}

async function replaceRoundAssignments(tx: Prisma.TransactionClient, sessionId: string, roundId: string, groupId: string, references: Array<{ problemId: string; alias?: string | null }>) {
  const group = await tx.trainingSessionGroup.findFirst({ where: { id: groupId, sessionId, status: 'active' } })
  if (!group) throw new TrainingEngineError(422, 'TRAINING_GROUP_NOT_FOUND', '训练分组不存在')
  const sessionProblems = await upsertSessionProblems(tx, sessionId, references)
  await tx.trainingRoundProblemAssignment.deleteMany({ where: { roundId, groupId } })
  if (sessionProblems.length) await tx.trainingRoundProblemAssignment.createMany({ data: sessionProblems.map((problem, orderIndex) => ({ roundId, groupId, sessionProblemId: problem.id, orderIndex })) })
}

export async function replaceCurrentAssignments(userId: string, sessionId: string, body: any) {
  const managed = await assertManage(userId, sessionId)
  assertRevision(managed.statusRevision, body?.expectedRevision)
  if (!managed.currentRoundId || !['RUNNING', 'PAUSED'].includes(managed.status)) throw new TrainingEngineError(409, 'TRAINING_ROUND_NOT_RUNNING', '当前没有可调整题目的训练轮次')
  await prisma.$transaction(async tx => {
    await lockTrainingSession(tx, sessionId, body?.expectedRevision)
    await replaceRoundAssignments(tx, sessionId, managed.currentRoundId!, String(body.groupId), body.problems || [])
    const participants = await tx.trainingSessionParticipant.findMany({ where: { sessionId, groupId: String(body.groupId), status: 'active' }, select: { id: true } })
    for (const participant of participants) await reconcileParticipantCurrentProblem(sessionId, participant.id, tx)
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'PROBLEMS_REPLACED', 'GROUP', String(body.groupId))
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function putTrainingNextRound(userId: string, sessionId: string, body: any) {
  const managed = await assertManage(userId, sessionId)
  assertRevision(managed.statusRevision, body?.expectedRevision)
  if (!['RUNNING', 'PAUSED'].includes(managed.status)) throw new TrainingEngineError(409, 'TRAINING_SESSION_NOT_ACTIVE', '只有进行中或暂停中的训练可以准备下一轮')
  const pending = managed.Rounds.find(round => round.lifecycle === 'PENDING')
  const groups = Array.isArray(body?.groups) ? body.groups : []
  if (!groups.length) throw new TrainingEngineError(422, 'TRAINING_ROUND_GROUP_REQUIRED', '下一轮至少需要一个分组题集')
  await prisma.$transaction(async tx => {
    await lockTrainingSession(tx, sessionId, body?.expectedRevision)
    const timeLimitSeconds = body?.timeLimitSeconds == null ? null : boundedInteger(body.timeLimitSeconds, 60, 7 * 24 * 3600, '本轮限时')
    const name = boundedText(body?.name, 200, '轮次名称', 1)
    const last = pending ? null : await tx.trainingSessionRound.findFirst({ where: { sessionId }, orderBy: { orderIndex: 'desc' } })
    const round = pending
      ? await tx.trainingSessionRound.update({ where: { id: pending.id }, data: { name, timeLimitSeconds } })
      : await tx.trainingSessionRound.create({ data: { sessionId, name, orderIndex: (last?.orderIndex ?? -1) + 1, timeLimitSeconds } })
    if (pending) await tx.trainingRoundProblemAssignment.deleteMany({ where: { roundId: round.id } })
    for (const group of groups) await replaceRoundAssignments(tx, sessionId, round.id, String(group.groupId), group.problems || [])
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, pending ? 'NEXT_ROUND_UPDATED' : 'NEXT_ROUND_PREPARED', 'ALL', null, { roundId: round.id })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function deleteTrainingNextRound(userId: string, sessionId: string, body: any) {
  const managed = await assertManage(userId, sessionId)
  assertRevision(managed.statusRevision, body?.expectedRevision)
  const pending = managed.Rounds.find(round => round.lifecycle === 'PENDING')
  if (!pending) throw new TrainingEngineError(404, 'TRAINING_NEXT_ROUND_NOT_FOUND', '没有已准备的下一轮')
  await prisma.$transaction(async tx => {
    await lockTrainingSession(tx, sessionId, body?.expectedRevision)
    await tx.trainingSessionRound.delete({ where: { id: pending.id } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'NEXT_ROUND_DELETED')
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function advanceTrainingRound(userId: string, sessionId: string, body: any) {
  const managed = await assertManage(userId, sessionId)
  assertRevision(managed.statusRevision, body?.expectedRevision)
  if (!['RUNNING', 'PAUSED'].includes(managed.status)) throw new TrainingEngineError(409, 'TRAINING_SESSION_NOT_ACTIVE', '当前训练不能进入下一轮')
  const pending = managed.Rounds.find(round => round.lifecycle === 'PENDING')
  if (!pending) throw new TrainingEngineError(409, 'TRAINING_NEXT_ROUND_NOT_FOUND', '请先准备下一轮')
  const now = new Date()
  await prisma.$transaction(async tx => {
    await lockTrainingSession(tx, sessionId, body?.expectedRevision)
    const current = managed.currentRoundId ? await tx.trainingSessionRound.findUnique({ where: { id: managed.currentRoundId } }) : null
    if (current?.lifecycle === 'RUNNING') await tx.trainingSessionRound.update({ where: { id: current.id }, data: { lifecycle: 'ENDED', activeElapsedSeconds: runningElapsed(current, now), runningSince: null, endedAt: now, endReason: 'TEACHER_ADVANCED' } })
    await tx.trainingSessionRound.update({ where: { id: pending.id }, data: { lifecycle: 'RUNNING', startedAt: now, runningSince: managed.status === 'RUNNING' ? now : null } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { currentRoundId: pending.id, statusRevision: { increment: 1 } } })
    const participants = await tx.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, select: { id: true } })
    for (const participant of participants) await reconcileParticipantCurrentProblem(sessionId, participant.id, tx)
    await appendEvent(tx, sessionId, 'ROUND_ADVANCED', 'ALL', null, { roundId: pending.id })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function replaceTrainingGrouping(userId: string, sessionId: string, body: any) {
  const managed = await assertManage(userId, sessionId)
  assertRevision(managed.statusRevision, body?.expectedRevision)
  const groups = Array.isArray(body?.groups) ? body.groups : []
  if (!groups.length) throw new TrainingEngineError(422, 'TRAINING_GROUP_REQUIRED', '至少保留一个训练组')
  const participantIds = managed.Groups.flatMap(group => group.Participants.map(participant => participant.id))
  const assigned = new Set<string>()
  for (const group of groups) for (const rawId of group.participantIds || []) {
    const id = String(rawId)
    if (!participantIds.includes(id)) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_NOT_FOUND', '分组包含不存在的学生')
    if (assigned.has(id)) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_DUPLICATED', '同一学生不能同时属于多个训练组')
    assigned.add(id)
  }
  if (assigned.size !== participantIds.length) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_UNASSIGNED', '每名学生都必须属于一个训练组')
  await prisma.$transaction(async tx => {
    await lockTrainingSession(tx, sessionId, body?.expectedRevision)
    const existing = await tx.trainingSessionGroup.findMany({ where: { sessionId, status: 'active' }, orderBy: { orderIndex: 'asc' } })
    for (const group of existing) await tx.trainingSessionGroup.update({ where: { id: group.id }, data: { name: `__moving__${group.id}`, orderIndex: group.orderIndex + 10_000 } })
    const resolved = []
    for (let index = 0; index < groups.length; index++) {
      const raw = groups[index]
      const current = raw.id ? existing.find(group => group.id === raw.id) : null
      const row = current
        ? await tx.trainingSessionGroup.update({ where: { id: current.id }, data: { name: boundedText(raw.name, 100, '分组名称', 1), orderIndex: index, status: 'active' } })
        : await tx.trainingSessionGroup.create({ data: { sessionId, name: boundedText(raw.name, 100, '分组名称', 1), orderIndex: index } })
      resolved.push(row)
      if (!current && managed.currentRoundId && existing[0]) {
        const source = await tx.trainingRoundProblemAssignment.findMany({ where: { roundId: managed.currentRoundId, groupId: existing[0].id, active: true }, orderBy: { orderIndex: 'asc' } })
        if (source.length) await tx.trainingRoundProblemAssignment.createMany({ data: source.map(item => ({ roundId: managed.currentRoundId!, groupId: row.id, sessionProblemId: item.sessionProblemId, orderIndex: item.orderIndex })) })
      }
    }
    const retained = new Set(resolved.map(group => group.id))
    for (const group of existing.filter(item => !retained.has(item.id))) await tx.trainingSessionGroup.update({ where: { id: group.id }, data: { status: 'archived', name: `已归档-${group.id}` } })
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) for (const participantId of groups[groupIndex].participantIds || []) {
      const participant = await tx.trainingSessionParticipant.findFirstOrThrow({ where: { id: String(participantId), sessionId } })
      if (participant.groupId !== resolved[groupIndex].id) {
        await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { groupId: resolved[groupIndex].id, currentSessionProblemId: null, returnSessionProblemId: null } })
        await tx.trainingSessionGroupChange.create({ data: { sessionId, participantId: participant.id, fromGroupId: participant.groupId, toGroupId: resolved[groupIndex].id, targetRoundId: managed.currentRoundId, reason: '教师调整分组', changedBy: userId } })
        await reconcileParticipantCurrentProblem(sessionId, participant.id, tx)
      }
    }
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'GROUPING_REPLACED')
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function changeTrainingGrouping(userId: string, sessionId: string, body: any) {
  const managed = await assertManage(userId, sessionId)
  assertRevision(managed.statusRevision, body?.expectedRevision)
  const toGroupId = String(body?.toGroupId || '')
  if (!managed.Groups.some(group => group.id === toGroupId)) throw new TrainingEngineError(422, 'TRAINING_GROUP_NOT_FOUND', '目标训练组不存在')
  const ids: string[] = [...new Set<string>((body?.participantIds || []).map((value: unknown) => String(value)))]
  const reason = boundedText(body?.reason, 2000, '换组原因', 1)
  await prisma.$transaction(async tx => {
    await lockTrainingSession(tx, sessionId, body?.expectedRevision)
    for (const participantId of ids) {
      const participant = await tx.trainingSessionParticipant.findFirst({ where: { id: participantId, sessionId, status: 'active' } })
      if (!participant) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_NOT_FOUND', '学员不在当前训练')
      if (participant.groupId === toGroupId) continue
      await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { groupId: toGroupId, currentSessionProblemId: null, returnSessionProblemId: null } })
      await tx.trainingSessionGroupChange.create({ data: { sessionId, participantId: participant.id, fromGroupId: participant.groupId, toGroupId, targetRoundId: managed.currentRoundId, reason, changedBy: userId } })
      await reconcileParticipantCurrentProblem(sessionId, participant.id, tx)
    }
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'GROUP_CHANGED', 'GROUP', toGroupId, { participantIds: ids, reason })
  })
  return getTrainingWorkspace(userId, sessionId)
}

async function targetParticipants(tx: Prisma.TransactionClient, sessionId: string, targetType: TrainingEngineTargetType, targetId: string | null) {
  return tx.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active', ...(targetType === 'GROUP' ? { groupId: targetId || '__missing__' } : {}), ...(targetType === 'USER' ? { userId: targetId || '__missing__' } : {}) } })
}

export async function executeTrainingCommand(userId: string, sessionId: string, body: any) {
  const managed = await assertManage(userId, sessionId)
  assertRevision(managed.statusRevision, body?.expectedRevision)
  const type = String(body?.type || '')
  const targetType = String(body?.targetType || 'ALL') as TrainingEngineTargetType
  const targetId = body?.targetId ? String(body.targetId) : null
  const payload = body?.payload && typeof body.payload === 'object' ? body.payload as Record<string, any> : {}
  const now = new Date()
  await prisma.$transaction(async tx => {
    const current = await lockTrainingSession(tx, sessionId, body?.expectedRevision)
    const update: Prisma.TrainingSessionUpdateInput = { statusRevision: { increment: 1 } }
    if (type === 'START_SESSION') {
      if (current.status !== 'READY') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有待开始训练可以开始')
      const round = await tx.trainingSessionRound.findFirst({ where: { sessionId, lifecycle: 'PENDING' }, orderBy: { orderIndex: 'asc' } })
      if (!round) throw new TrainingEngineError(409, 'TRAINING_ROUND_REQUIRED', '训练没有可开始的第一轮')
      await tx.trainingSessionRound.update({ where: { id: round.id }, data: { lifecycle: 'RUNNING', startedAt: now, runningSince: now } })
      Object.assign(update, { status: 'RUNNING', currentRoundId: round.id, startedAt: now, runningSince: now })
    } else if (type === 'PAUSE_SESSION') {
      if (current.status !== 'RUNNING') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有进行中的训练可以暂停')
      Object.assign(update, { status: 'PAUSED', pausedAt: now, runningSince: null, activeElapsedSeconds: runningElapsed(current, now) })
      if (current.currentRoundId) {
        const round = await tx.trainingSessionRound.findUnique({ where: { id: current.currentRoundId } })
        if (round?.lifecycle === 'RUNNING') await tx.trainingSessionRound.update({ where: { id: round.id }, data: { activeElapsedSeconds: runningElapsed(round, now), runningSince: null } })
      }
    } else if (type === 'RESUME_SESSION') {
      if (current.status !== 'PAUSED') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有暂停中的训练可以继续')
      Object.assign(update, { status: 'RUNNING', pausedAt: null, runningSince: now })
      if (current.currentRoundId) await tx.trainingSessionRound.updateMany({ where: { id: current.currentRoundId, lifecycle: 'RUNNING' }, data: { runningSince: now } })
    } else if (type === 'EXTEND_SESSION') {
      if (!['RUNNING', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '当前训练不能增加时间')
      update.totalDurationSeconds = { increment: boundedInteger(payload.seconds, 60, 7 * 24 * 3600, '增加时间') }
    } else if (type === 'EXTEND_ROUND') {
      if (!current.currentRoundId) throw new TrainingEngineError(409, 'TRAINING_ROUND_NOT_RUNNING', '当前没有运行中的轮次')
      const round = await tx.trainingSessionRound.findUniqueOrThrow({ where: { id: current.currentRoundId } })
      if (round.timeLimitSeconds == null) throw new TrainingEngineError(409, 'TRAINING_ROUND_UNTIMED', '普通轮次没有独立倒计时')
      await tx.trainingSessionRound.update({ where: { id: round.id }, data: { timeLimitSeconds: { increment: boundedInteger(payload.seconds, 60, 7 * 24 * 3600, '本轮增加时间') } } })
    } else if (type === 'FOCUS_PROBLEM') {
      if (current.status !== 'RUNNING') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有进行中的训练可以聚焦题目')
      const sessionProblemId = String(payload.sessionProblemId || '')
      if (!sessionProblemId) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_REQUIRED', '请选择要聚焦的题目')
      const participants = await targetParticipants(tx, sessionId, targetType, targetId)
      if (!participants.length) throw new TrainingEngineError(422, 'TRAINING_COMMAND_TARGET_REQUIRED', '聚焦范围内没有学生')
      for (const participant of participants) {
        const effective = await resolveEffectiveSessionProblems(sessionId, participant.id, tx)
        if (!effective.some(problem => problem.id === sessionProblemId)) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_EFFECTIVE', '只能聚焦目标学生当前可见的题目')
      }
      await tx.trainingSessionOverlay.updateMany({ where: { sessionId, type: 'FOCUS', status: 'active', targetType, targetId }, data: { status: 'ended', endedAt: now } })
      await tx.trainingSessionOverlay.create({ data: { sessionId, type: 'FOCUS', targetType, targetId, sessionProblemId, createdBy: userId } })
      for (const participant of participants) await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { returnSessionProblemId: participant.returnSessionProblemId || participant.currentSessionProblemId, currentSessionProblemId: sessionProblemId } })
    } else if (type === 'END_FOCUS') {
      await tx.trainingSessionOverlay.updateMany({ where: { sessionId, type: 'FOCUS', status: 'active', ...(targetType === 'ALL' ? {} : { targetType, targetId }) }, data: { status: 'ended', endedAt: now } })
      const participants = await targetParticipants(tx, sessionId, targetType, targetId)
      for (const participant of participants) {
        await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { currentSessionProblemId: participant.returnSessionProblemId, returnSessionProblemId: null } })
        await reconcileParticipantCurrentProblem(sessionId, participant.id, tx)
      }
    } else if (type === 'END_SESSION') {
      if (!['RUNNING', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '当前训练不能结束')
      Object.assign(update, { status: 'ENDED', endedAt: now, runningSince: null, pausedAt: null, activeElapsedSeconds: current.status === 'RUNNING' ? runningElapsed(current, now) : current.activeElapsedSeconds })
      if (current.currentRoundId) {
        const round = await tx.trainingSessionRound.findUnique({ where: { id: current.currentRoundId } })
        if (round?.lifecycle === 'RUNNING') await tx.trainingSessionRound.update({ where: { id: round.id }, data: { lifecycle: 'ENDED', activeElapsedSeconds: current.status === 'RUNNING' ? runningElapsed(round, now) : round.activeElapsedSeconds, runningSince: null, endedAt: now, endReason: 'SESSION_ENDED' } })
      }
    } else throw new TrainingEngineError(422, 'UNKNOWN_TRAINING_COMMAND', `不支持的训练命令：${type}`)
    const sequence = await tx.trainingSession.update({ where: { id: sessionId }, data: { commandSeq: { increment: 1 } }, select: { commandSeq: true } })
    await tx.trainingSessionCommand.create({ data: { sessionId, seq: sequence.commandSeq, type, targetType, targetId, payload: asJson(payload), createdBy: userId } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: update })
    await appendEvent(tx, sessionId, type, targetType, targetId, payload)
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function archiveTrainingSession(userId: string, sessionId: string, expectedRevision: number) {
  const session = await assertManage(userId, sessionId)
  assertRevision(session.statusRevision, expectedRevision)
  return prisma.$transaction(async tx => {
    const current = await lockTrainingSession(tx, sessionId, expectedRevision)
    if (current.status !== 'ENDED') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有已结束训练可以归档')
    const updated = await tx.trainingSession.update({ where: { id: sessionId }, data: { status: 'ARCHIVED', archivedAt: new Date(), statusRevision: { increment: 1 } }, include: { Team: { select: { name: true } }, _count: { select: { Problems: true, Participants: true } } } })
    return summary(updated)
  })
}

export async function joinTrainingSession(userId: string, sessionId: string) {
  const session = await loadSession(sessionId)
  if (!session) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  if (await canManageSession(userId, session)) return { id: sessionId }
  if (await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })) return { id: sessionId }
  const eligible = new Set(await eligibleTrainingParticipantIds({ organizationId: session.organizationId, teamId: session.teamId }))
  if (!eligible.has(userId)) throw new TrainingEngineError(403, 'TRAINING_SESSION_FORBIDDEN', '你不在该训练范围内')
  const group = session.Groups[0]
  if (!group) throw new TrainingEngineError(409, 'TRAINING_GROUP_REQUIRED', '训练没有可加入的分组')
  const participant = await prisma.trainingSessionParticipant.create({ data: { sessionId, userId, groupId: group.id } })
  await reconcileParticipantCurrentProblem(sessionId, participant.id)
  return { id: participant.id }
}

export async function saveTrainingDraft(userId: string, sessionId: string, sessionProblemId: string, body: any) {
  const session = await assertAccess(userId, sessionId)
  const problem = session.Problems.find(item => item.id === sessionProblemId)
  if (!problem) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  if (!await canManageSession(userId, session)) {
    const participant = await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { sessionId_userId: { sessionId, userId } } })
    if (!(await resolveEffectiveSessionProblems(sessionId, participant.id)).some(item => item.id === sessionProblemId)) throw new TrainingEngineError(403, 'TRAINING_PROBLEM_NOT_EFFECTIVE', '该题当前不在你的训练题集中')
  }
  const code = String(body?.code || '')
  if (Buffer.byteLength(code, 'utf8') > 1024 * 1024) throw new TrainingEngineError(422, 'TRAINING_DRAFT_TOO_LARGE', '代码不能超过 1 MiB')
  const key = { sessionId_userId_sessionProblemId: { sessionId, userId, sessionProblemId } }
  const existing = await prisma.trainingSessionProblemDraft.findUnique({ where: key })
  if (body?.expectedRevision && existing && existing.revision !== Number(body.expectedRevision)) throw new TrainingEngineError(409, 'TRAINING_DRAFT_CONFLICT', '草稿已在其他页面更新')
  return prisma.trainingSessionProblemDraft.upsert({
    where: key,
    update: { language: String(body?.language || 'cpp17'), code, inputFilename: body?.inputFilename || null, outputFilename: body?.outputFilename || null, editorFocused: Boolean(body?.editorFocused), revision: { increment: 1 } },
    create: { sessionId, userId, sessionProblemId, language: String(body?.language || 'cpp17'), code, inputFilename: body?.inputFilename || null, outputFilename: body?.outputFilename || null, editorFocused: Boolean(body?.editorFocused) },
  })
}

export async function getTrainingDraft(userId: string, sessionId: string, sessionProblemId: string) {
  await assertAccess(userId, sessionId)
  return prisma.trainingSessionProblemDraft.findUnique({ where: { sessionId_userId_sessionProblemId: { sessionId, userId, sessionProblemId } } })
}

export async function recordHeartbeat(userId: string, sessionId: string, body: any) {
  const session = await assertAccess(userId, sessionId)
  const participant = await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { sessionId_userId: { sessionId, userId } } })
  const sessionProblemId = String(body?.sessionProblemId || '')
  if (!(await resolveEffectiveSessionProblems(sessionId, participant.id)).some(problem => problem.id === sessionProblemId)) throw new TrainingEngineError(403, 'TRAINING_PROBLEM_NOT_EFFECTIVE', '该题当前不在你的训练题集中')
  const now = new Date()
  const elapsed = participant.lastHeartbeatAt ? Math.min(60, Math.max(0, Math.floor((now.getTime() - participant.lastHeartbeatAt.getTime()) / 1000))) : 0
  return prisma.$transaction(async tx => {
    const updatedParticipant = await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { lastHeartbeatAt: now, activeSeconds: { increment: elapsed }, currentSessionProblemId: sessionProblemId } })
    const progress = await tx.trainingSessionProblemProgress.upsert({
      where: { participantId_sessionProblemId: { participantId: participant.id, sessionProblemId } },
      update: { status: 'WORKING', lastOpenedAt: now, activeSeconds: { increment: body?.pageVisible && body?.editorFocused && session.status === 'RUNNING' ? elapsed : 0 }, lastProgressAt: now },
      create: { participantId: participant.id, sessionProblemId, status: 'WORKING', firstOpenedAt: now, lastOpenedAt: now, lastProgressAt: now },
    })
    return { participant: updatedParticipant, progress }
  })
}

export async function submitTrainingSolution(userId: string, sessionId: string, body: any) {
  const session = await assertAccess(userId, sessionId)
  assertTrainingSubmissionWindow(session)
  const participant = await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { sessionId_userId: { sessionId, userId } } })
  const sessionProblemId = String(body?.sessionProblemId || '')
  const sessionProblem = (await resolveEffectiveSessionProblems(sessionId, participant.id)).find(problem => problem.id === sessionProblemId)
  if (!sessionProblem) throw new TrainingEngineError(403, 'TRAINING_PROBLEM_NOT_EFFECTIVE', '该题当前不在你的训练题集中')
  const language = boundedText(body?.language, 30, '语言', 1)
  const code = String(body?.code || '')
  if (!code.trim() || Buffer.byteLength(code, 'utf8') > 1024 * 1024) throw new TrainingEngineError(422, 'INVALID_SUBMISSION_CODE', '代码不能为空且不能超过 1 MiB')
  const io = normalizeSubmissionIo({ inputFilename: body?.inputFilename, outputFilename: body?.outputFilename, problemType: null })
  return createQueuedSubmissionWithRun({
    userId, workspaceScope: session.organizationId ? 'campus' : 'personal', organizationId: session.organizationId,
    oj: sessionProblem.Problem.platform, problemId: sessionProblem.Problem.problemId, language, code,
    codeLength: Buffer.byteLength(code, 'utf8'), submitMethod: 'local', problemInternalId: sessionProblem.problemId,
    submitScope: 'training_engine', trainingSessionId: sessionId, trainingSessionProblemId: sessionProblemId,
    trainingRoundId: session.currentRoundId, ...io, isGlobalVisible: true,
  }, { requestedBy: userId })
}

export async function syncTrainingEngineSubmission(input: { id: number; userId: string; trainingSessionId: string | null; trainingSessionProblemId: string | null; result: string | null; score: number | null }) {
  if (!input.trainingSessionId || !input.trainingSessionProblemId || !input.result) return
  await prisma.$transaction(async tx => {
    if (await tx.trainingSessionScoreEvent.findUnique({ where: { submissionId: input.id } })) return
    const participant = await tx.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId: input.trainingSessionId!, userId: input.userId } } })
    if (!participant) return
    const key = { participantId_sessionProblemId: { participantId: participant.id, sessionProblemId: input.trainingSessionProblemId! } }
    const existing = await tx.trainingSessionProblemProgress.findUnique({ where: key })
    const accepted = isAccepted(input.result)
    const score = input.score ?? (accepted ? 100 : 0)
    const bestScore = Math.max(existing?.bestScore ?? 0, score)
    const completed = Boolean(existing?.acAt) || accepted || bestScore >= 100
    await tx.trainingSessionProblemProgress.upsert({
      where: key,
      update: { status: completed ? 'COMPLETED' : 'WORKING', attemptCount: { increment: 1 }, bestScore, bestVerdict: existing?.acAt ? existing.bestVerdict : accepted ? 'Accepted' : input.result, acAt: existing?.acAt || (accepted ? new Date() : null), lastSubmissionAt: new Date(), lastProgressAt: new Date() },
      create: { participantId: participant.id, sessionProblemId: input.trainingSessionProblemId!, status: completed ? 'COMPLETED' : 'WORKING', attemptCount: 1, bestScore, bestVerdict: accepted ? 'Accepted' : input.result, acAt: accepted ? new Date() : null, lastSubmissionAt: new Date(), lastProgressAt: new Date() },
    })
    await tx.trainingSessionScoreEvent.create({ data: { sessionId: input.trainingSessionId!, participantId: participant.id, sessionProblemId: input.trainingSessionProblemId!, submissionId: input.id, score, verdict: input.result } })
    await appendEvent(tx, input.trainingSessionId!, 'SUBMISSION_JUDGED', 'USER', input.userId, { sessionProblemId: input.trainingSessionProblemId, result: input.result, score })
  })
}

type TrainingRankingProgress = { sessionProblemId: string; status: string; bestScore?: number | null; attemptCount: number }
type TrainingRankingSubmission = { userId: string; trainingSessionProblemId: string | null; createdAt: Date; CurrentJudgeRun?: { result?: string | null } | null }

export function calculateTrainingRankingMetrics(input: {
  sessionType: string
  effectiveProblemIds: Iterable<string>
  progress: TrainingRankingProgress[]
  submissions: TrainingRankingSubmission[]
  userId: string
  startedAt: Date
}) {
  const effective = new Set(input.effectiveProblemIds)
  const progress = input.progress.filter(item => effective.has(item.sessionProblemId))
  const base = {
    completed: progress.filter(item => item.status === 'COMPLETED').length,
    total: effective.size,
    score: progress.reduce((sum, item) => sum + Number(item.bestScore || 0), 0),
    attempts: progress.reduce((sum, item) => sum + item.attemptCount, 0),
    penaltyMinutes: 0,
  }
  if (input.sessionType !== 'ACM') return base
  let completed = 0
  let attempts = 0
  let penaltyMinutes = 0
  for (const problemId of effective) {
    const history = input.submissions.filter(item => item.userId === input.userId && item.trainingSessionProblemId === problemId)
    const acceptedIndex = history.findIndex(item => isAccepted(item.CurrentJudgeRun?.result))
    if (acceptedIndex >= 0) {
      completed++
      attempts += acceptedIndex + 1
      penaltyMinutes += Math.max(0, Math.floor((history[acceptedIndex].createdAt.getTime() - input.startedAt.getTime()) / 60_000)) + acceptedIndex * 20
    } else attempts += history.length
  }
  return { ...base, completed, attempts, penaltyMinutes }
}
async function rankingRows(userId: string, sessionId: string, requestedGroupId?: string) {
  const session = await assertAccess(userId, sessionId)
  const manager = await canManageSession(userId, session)
  const participants = await prisma.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, include: { Progress: true }, orderBy: { joinedAt: 'asc' } })
  const effectiveByParticipant = new Map<string, string[]>()
  for (const participant of participants) effectiveByParticipant.set(participant.id, (await resolveEffectiveSessionProblems(sessionId, participant.id)).map(problem => problem.id))
  const signatures = new Set([...effectiveByParticipant.values()].map(ids => [...ids].sort().join('|')))
  let selected = participants
  let scope: 'all' | 'group' = 'all'
  let groupId: string | null = null
  if (signatures.size > 1) {
    scope = 'group'
    const viewerGroupId = participants.find(participant => participant.userId === userId)?.groupId || null
    if (requestedGroupId && !session.Groups.some(group => group.id === requestedGroupId)) {
      throw new TrainingEngineError(422, 'TRAINING_GROUP_NOT_FOUND', '排名分组不存在')
    }
    if (!manager && requestedGroupId && requestedGroupId !== viewerGroupId) {
      throw new TrainingEngineError(403, 'TRAINING_RANKING_GROUP_FORBIDDEN', '只能查看自己所在分组的排名')
    }
    groupId = manager
      ? requestedGroupId || session.Groups[0]?.id || null
      : viewerGroupId
    selected = groupId ? participants.filter(participant => participant.groupId === groupId) : []
  }
  const userMap = await participantDisplayNames(session, selected.map(participant => participant.userId))
  const submissions = session.sessionType === 'ACM' ? await prisma.submission.findMany({
    where: { trainingSessionId: sessionId, userId: { in: selected.map(participant => participant.userId) }, trainingSessionProblemId: { not: null } },
    orderBy: { createdAt: 'asc' },
    include: { CurrentJudgeRun: { select: { result: true, score: true } } },
  }) : []
  const startedAt = session.startedAt || session.createdAt
  const rows = selected.map(participant => ({
    user: userMap.get(participant.userId)!,
    ...calculateTrainingRankingMetrics({
      sessionType: session.sessionType,
      effectiveProblemIds: effectiveByParticipant.get(participant.id) || [],
      progress: participant.Progress,
      submissions,
      userId: participant.userId,
      startedAt,
    }),
  }))
  rows.sort((left, right) => session.sessionType === 'ACM'
    ? right.completed - left.completed || left.penaltyMinutes - right.penaltyMinutes || left.user.username.localeCompare(right.user.username)
    : session.sessionType === 'OI'
      ? right.score - left.score || right.completed - left.completed || left.user.username.localeCompare(right.user.username)
      : right.completed - left.completed || right.score - left.score || left.user.username.localeCompare(right.user.username))
  return { session, scope, groupId, entries: rows.map((row, index) => ({ rank: index + 1, ...row })) }
}

export async function getTrainingPeerProgress(userId: string, sessionId: string, groupId?: string) {
  const result = await rankingRows(userId, sessionId, groupId)
  return { sessionType: result.session.sessionType, scope: result.scope, groupId: result.groupId, entries: result.entries }
}

export async function getCoachDashboard(userId: string, sessionId: string) {
  const session = await assertManage(userId, sessionId)
  const participants = await prisma.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, include: { Progress: true }, orderBy: { joinedAt: 'asc' } })
  const names = await participantDisplayNames(session, participants.map(participant => participant.userId))
  const now = Date.now()
  const rows = []
  for (const participant of participants) {
    const effective = await resolveEffectiveSessionProblems(sessionId, participant.id)
    const effectiveIds = new Set(effective.map(problem => problem.id))
    const progress = participant.Progress.filter(item => effectiveIds.has(item.sessionProblemId))
    rows.push({ id: participant.id, user: names.get(participant.userId)!, currentGroupId: participant.groupId, currentSessionProblemId: participant.currentSessionProblemId, activeSeconds: participant.activeSeconds, online: Boolean(participant.lastHeartbeatAt && now - participant.lastHeartbeatAt.getTime() < 90_000), completed: progress.filter(item => item.status === 'COMPLETED').length, total: effective.length, progress })
  }
  return { session: summary(session), participants: rows, summary: { total: rows.length, working: rows.filter(item => item.completed < item.total).length, completed: rows.filter(item => item.total > 0 && item.completed === item.total).length } }
}

export async function getTrainingReport(userId: string, sessionId: string) {
  const session = await assertManage(userId, sessionId)
  const [groupChanges, ranking] = await Promise.all([prisma.trainingSessionGroupChange.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } }), getTrainingPeerProgress(userId, sessionId)])
  return { session: summary(session), rounds: session.Rounds, groupChanges, ranking }
}

export async function listTrainingEvents(userId: string, sessionId: string, after: number) {
  await assertAccess(userId, sessionId)
  return prisma.trainingSessionEvent.findMany({ where: { sessionId, seq: { gt: Math.max(0, after) }, expiresAt: { gt: new Date() } }, orderBy: { seq: 'asc' }, take: 200 })
}

export async function processDueTrainingSessions(now = new Date()) {
  const ready = await prisma.trainingSession.findMany({ where: { status: 'READY', scheduledStartAt: { lte: now } }, select: { id: true }, take: 100 })
  let started = 0, roundsEnded = 0, ended = 0
  for (const item of ready) try {
    await prisma.$transaction(async tx => {
      const current = await lockTrainingSession(tx, item.id)
      if (current.status !== 'READY') return
      const round = await tx.trainingSessionRound.findFirst({ where: { sessionId: item.id, lifecycle: 'PENDING' }, orderBy: { orderIndex: 'asc' } })
      if (!round) return
      await tx.trainingSessionRound.update({ where: { id: round.id }, data: { lifecycle: 'RUNNING', startedAt: now, runningSince: now } })
      await tx.trainingSession.update({ where: { id: item.id }, data: { status: 'RUNNING', currentRoundId: round.id, startedAt: now, runningSince: now, statusRevision: { increment: 1 } } })
      await appendEvent(tx, item.id, 'SESSION_STARTED', 'ALL', null, { automatic: true, roundId: round.id })
      started++
    })
  } catch { /* another scheduler won */ }

  const running = await prisma.trainingSession.findMany({ where: { status: 'RUNNING' }, include: { CurrentRound: true }, take: 200 })
  for (const session of running) try {
    if (runningElapsed(session, now) >= session.totalDurationSeconds) {
      await prisma.$transaction(async tx => {
        await lockTrainingSession(tx, session.id)
        const current = await tx.trainingSession.findUnique({ where: { id: session.id }, include: { CurrentRound: true } })
        if (!current || current.status !== 'RUNNING') return
        if (current.CurrentRound?.lifecycle === 'RUNNING') await tx.trainingSessionRound.update({ where: { id: current.CurrentRound.id }, data: { lifecycle: 'ENDED', activeElapsedSeconds: runningElapsed(current.CurrentRound, now), runningSince: null, endedAt: now, endReason: 'SESSION_ENDED' } })
        await tx.trainingSession.update({ where: { id: current.id }, data: { status: 'ENDED', activeElapsedSeconds: runningElapsed(current, now), runningSince: null, endedAt: now, statusRevision: { increment: 1 } } })
        await appendEvent(tx, current.id, 'SESSION_ENDED', 'ALL', null, { automatic: true })
        ended++
      })
      continue
    }
    const round = session.CurrentRound
    if (round?.lifecycle === 'RUNNING' && round.timeLimitSeconds != null && runningElapsed(round, now) >= round.timeLimitSeconds) {
      await prisma.$transaction(async tx => {
        await lockTrainingSession(tx, session.id)
        const current = await tx.trainingSession.findUnique({ where: { id: session.id }, include: { CurrentRound: true } })
        if (!current?.CurrentRound || current.CurrentRound.lifecycle !== 'RUNNING') return
        await tx.trainingSessionRound.update({ where: { id: current.CurrentRound.id }, data: { lifecycle: 'ENDED', activeElapsedSeconds: runningElapsed(current.CurrentRound, now), runningSince: null, endedAt: now, endReason: 'TIME_REACHED' } })
        await tx.trainingSession.update({ where: { id: current.id }, data: { currentRoundId: null, statusRevision: { increment: 1 } } })
        await appendEvent(tx, current.id, 'ROUND_ENDED', 'ALL', null, { automatic: true })
        roundsEnded++
      })
    }
  } catch { /* another scheduler won */ }
  return { started, roundsEnded, ended }
}
