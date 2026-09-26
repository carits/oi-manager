import crypto from 'node:crypto'
import yaml from 'js-yaml'
import type { Prisma, TrainingEngineSessionStatus, TrainingEngineTargetType } from '@prisma/client'
import { prisma } from '../../prisma'
import { isOrganizationContestAdmin, isOrganizationMember, isTeamAdmin, isTeamMember } from './training-auth.service'
import { createQueuedSubmissionWithRun } from '../judge/application/judge-run.service'
import { normalizeSubmissionIo } from '../judge/domain/submission-io'
import { BUILTIN_TRAINING_TEMPLATES, getBuiltinTrainingTemplate } from './training-engine.templates'
import { TrainingEngineError } from './training-engine.errors'
import { eligibleTrainingParticipantIds, validateTrainingParticipantTarget } from './application/training-roster.service'
import { trainingMetrics } from './training-metrics'
import { assertTrainingDefinitionWritesEnabled } from './training-rollout'
import { createTrainingCommandDispatcher } from './training-command.service'
import { createTrainingRuntimeCommandHandlers } from './training-command.handlers'
import { TrainingEventTypes } from './training-events'
import {
  requiredSessionProblemIds,
  resolveParticipantSessionRequirements,
  resolveParticipantStageRequirements,
} from './training-requirement.service'
import {
  type TrainingPermissionContext,
  resolveAllTrainingPermissions,
  resolveTrainingPermissionFromContext,
  resolveTrainingPermissionLoaded,
  targetApplies,
} from './training-permission.service'
import {
  evaluateProblemTimePolicy,
  normalizeTrainingAccessScope,
  normalizeTrainingProblemTimePolicy,
  resolveEffectiveTrainingRule,
  resolveNextScoreTarget,
  serializeTrainingProblemTimePolicy,
} from './domain/training-rule-engine'

export { TrainingEngineError } from './training-engine.errors'

type SessionShape = NonNullable<Awaited<ReturnType<typeof loadSession>>>
type StructureStage = {
  id?: string
  clientKey?: string
  name: string
  description?: string | null
  kind?: string
  plannedDurationSeconds?: number | null
  endPolicy?: string
  accessPolicy?: string
  accessScope?: string
  submissionMode?: string
  defaultTargetScore?: number | null
  completionThreshold?: number | null
  minDurationSeconds?: number | null
  rules?: unknown
  problems?: Array<{
    assignmentId?: string
    clientKey?: string
    problemId: string
    testSetRevisionId?: string
    alias?: string | null
    unlockPolicy?: unknown
    targetScore?: number | null
    timePolicy?: unknown
    stuckPolicy?: unknown
    hintPolicy?: unknown
    allowedSubtaskIds?: number[]
    strategyIntervalSeconds?: number | null
    scoreGoals?: Array<{ score: number; allowedSubtaskIds?: number[] }>
  }>

}

const COMMANDS = new Set([
  'PAUSE_SESSION', 'RESUME_SESSION',
  'FOCUS_PROBLEM', 'END_FOCUS', 'LOCK_PROBLEM', 'UNLOCK_PROBLEM', 'ENABLE_SUBMISSION', 'DISABLE_SUBMISSION',
  'OPEN_HINT', 'CLOSE_HINT', 'UNLOCK_FOR_USER', 'SKIP_FOR_USER', 'CLEAR_STUCK_FOR_USER', 'MOVE_GROUP', 'SHOW_MESSAGE', 'CLEAR_MESSAGE',
])
const SESSION_WIDE_COMMANDS = new Set([
  'PAUSE_SESSION', 'RESUME_SESSION',
])

const COMMAND_ALLOWED_SESSION_STATUS: Record<string, ReadonlySet<string>> = {
  PAUSE_SESSION: new Set(['RUNNING']),
  RESUME_SESSION: new Set(['PAUSED']),
  FOCUS_PROBLEM: new Set(['RUNNING']),
  END_FOCUS: new Set(['RUNNING', 'PAUSED']),
  LOCK_PROBLEM: new Set(['RUNNING', 'PAUSED']),
  UNLOCK_PROBLEM: new Set(['RUNNING', 'PAUSED']),
  ENABLE_SUBMISSION: new Set(['RUNNING', 'PAUSED']),
  DISABLE_SUBMISSION: new Set(['RUNNING', 'PAUSED']),
  OPEN_HINT: new Set(['RUNNING', 'PAUSED']),
  CLOSE_HINT: new Set(['RUNNING', 'PAUSED']),
  UNLOCK_FOR_USER: new Set(['RUNNING', 'PAUSED']),
  SKIP_FOR_USER: new Set(['RUNNING', 'PAUSED']),
  CLEAR_STUCK_FOR_USER: new Set(['RUNNING', 'PAUSED']),
  MOVE_GROUP: new Set(['RUNNING', 'PAUSED']),
  SHOW_MESSAGE: new Set(['RUNNING', 'PAUSED']),
  CLEAR_MESSAGE: new Set(['RUNNING', 'PAUSED']),
}

function assertTrainingCommandAllowed(type: string, status: string) {
  const allowed = COMMAND_ALLOWED_SESSION_STATUS[type]
  if (!allowed?.has(status)) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', `训练状态 ${status} 不允许执行 ${type}`)
}
const SESSION_TYPES = new Set(['OI', 'ACM', 'GENERAL'])
const STAGE_KINDS = new Set(['TRAINING', 'TEACHING', 'REVIEW'])
const END_POLICIES = new Set(['MANUAL', 'TIME', 'COMPLETION', 'HYBRID'])
const ACCESS_POLICIES = new Set(['ALL_AT_ONCE', 'SEQUENTIAL', 'TEACHER_CONTROLLED'])
const SUBMISSION_MODES = new Set(['ENABLED', 'DISABLED'])
const RANKING_MODES = new Set(['OFF', 'PROGRESS_ONLY', 'SCORE', 'ACM_RANKING'])
const PEER_VISIBILITY = new Set(['NONE', 'PROGRESS', 'SCORE', 'FULL'])
const JOIN_MODES = new Set(['CURRENT_STAGE', 'TEACHER_ASSIGN'])
const HINT_OPEN_MODES = new Set(['MANUAL', 'TIME', 'ATTEMPT', 'SCORE'])
const PROBLEM_TIME_MODES = new Set(['NONE', 'SOFT', 'HARD', 'SWITCH_REQUIRED', 'REMIND', 'RECOMMEND_SWITCH', 'LOCK_SUBMISSION', 'FORCE_SWITCH'])

function enumValue(value: unknown, allowed: Set<string>, fallback: string, field: string) {
  const normalized = String(value || fallback).toUpperCase()
  if (!allowed.has(normalized)) throw new TrainingEngineError(422, 'INVALID_TRAINING_SESSION', `${field}不受支持`)
  return normalized
}

function normalizeUnlockPolicy(value: unknown) {
  if (value === undefined || value === null) return undefined
  const policy = parseJsonObject(value)
  const mode = enumValue(policy.mode, new Set(['ANY', 'ALL']), 'ANY', '解锁组合方式')
  const conditions = Array.isArray(policy.conditions) ? policy.conditions : []
  if (!conditions.length || conditions.length > 10) throw new TrainingEngineError(422, 'INVALID_TRAINING_UNLOCK_POLICY', '解锁规则必须包含 1～10 个条件')
  return {
    mode,
    conditions: conditions.map((condition: any, index: number) => {
      const type = enumValue(condition?.type, new Set(['AC', 'SCORE', 'TIME', 'ATTEMPTS', 'TEACHER']), 'AC', `第 ${index + 1} 个解锁条件`)
      if (type === 'TEACHER' || type === 'AC') return { type }
      const maximum = type === 'SCORE' ? 100 : type === 'ATTEMPTS' ? 1000 : 7 * 24 * 3600
      return { type, value: boundedInteger(condition?.value, type === 'SCORE' ? 0 : 1, maximum, `第 ${index + 1} 个解锁条件值`, false) }
    }),
  }
}

function boundedText(value: unknown, max: number, field: string, min = 0) {
  const text = String(value ?? '').trim()
  if (text.length < min || text.length > max) throw new TrainingEngineError(422, 'INVALID_TRAINING_SESSION', `${field}长度必须为 ${min}～${max} 个字符`)
  return text
}

function boundedInteger(value: unknown, min: number, max: number, field: string, nullable = true) {
  if ((value === null || value === undefined || value === '') && nullable) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new TrainingEngineError(422, 'INVALID_TRAINING_SESSION', `${field}必须为 ${min}～${max} 的整数`)
  return parsed
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

function parseJsonObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function normalizeProblemTimePolicy(value: unknown) {
  if (value === undefined || value === null) return undefined
  const policy = parseJsonObject(value)
  const rawMode = policy.action || policy.mode || 'NONE'
  enumValue(rawMode, PROBLEM_TIME_MODES, 'NONE', '单题时间策略')
  if (String(rawMode).toUpperCase() === 'NONE') return { mode: 'NONE' }
  const limitSeconds = boundedInteger(policy.limitSeconds, 60, 86400, '单题时间限制', false)
  return serializeTrainingProblemTimePolicy(normalizeTrainingProblemTimePolicy({ ...policy, mode: rawMode, limitSeconds }))
}

function normalizeStuckPolicy(value: unknown) {
  if (value === undefined || value === null) return undefined
  const policy = parseJsonObject(value)
  return {
    minActiveSeconds: boundedInteger(policy.minActiveSeconds, 60, 86400, '卡题最短活跃时间', false),
    minAttempts: boundedInteger(policy.minAttempts, 1, 1000, '卡题最少提交次数', false),
    noImprovementSeconds: boundedInteger(policy.noImprovementSeconds, 60, 86400, '卡题无提升时间', false),
  }
}

function normalizeSessionSettings(value: unknown, scheduledStartAt: Date | null) {
  const source = parseJsonObject(value)
  const dueAt = optionalDate(source.dueAt, '训练截止时间')
  if (dueAt && scheduledStartAt && dueAt <= scheduledStartAt) throw new TrainingEngineError(422, 'TRAINING_DUE_AT_INVALID', '训练截止时间必须晚于开始时间')
  const completionMode = source.completionMode === 'count' ? 'count' : 'all'
  const requiredProblemCount = completionMode === 'count'
    ? boundedInteger(source.requiredProblemCount, 1, 100, '至少完成题数', false)
    : null
  const participantTarget = ['team', 'organization_students', 'custom_students'].includes(String(source.participantTarget))
    ? String(source.participantTarget)
    : undefined
  return { dueAt: dueAt?.toISOString() || null, completionMode, requiredProblemCount, participantTarget }
}

export async function loadSession(id: string) {
  return prisma.trainingSession.findUnique({ where: { id }, include: {
    Stages: { orderBy: { orderIndex: 'asc' }, include: {
      Problems: { orderBy: { orderIndex: 'asc' }, include: { Problem: { select: { id: true, platform: true, problemId: true, title: true, difficulty: true, timeLimit: true, memoryLimit: true } }, TestSetRevision: { select: { id: true, revisionNumber: true, mode: true, judgeConfigHash: true } }, Plans: { orderBy: { orderIndex: 'asc' } } } },
      Groups: { orderBy: { TrainingGroup: { orderIndex: 'asc' } }, include: { ProblemPlans: { orderBy: { orderIndex: 'asc' } }, TrainingGroup: true } },
      ParticipantAssignments: { include: { Participant: { select: { userId: true } } } },
      TimeAdjustments: { orderBy: { createdAt: 'asc' } },
    } },
    Groups: { orderBy: { orderIndex: 'asc' }, include: {
      Participants: { select: { id: true, userId: true, status: true } },
      StageGroups: { include: { Stage: { select: { id: true, name: true, orderIndex: true } }, ProblemPlans: { orderBy: { orderIndex: 'asc' } } }, orderBy: { Stage: { orderIndex: 'asc' } } },
    } },
    Overlays: { where: { status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { startedAt: 'asc' } },
  } })
}

async function globalRole(userId: string) {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } })) || null
}

export async function canManageSession(userId: string, session: { teamId: string | null; organizationId: string | null; createdBy: string }) {
  const user = await globalRole(userId)
  if (!user || user.status !== 'active') return false
  if (user.role === 'super_admin') return true
  if (session.createdBy === userId) return true
  if (session.teamId) return isTeamAdmin(userId, session.teamId)
  if (session.organizationId) return isOrganizationContestAdmin(userId, session.organizationId, session.createdBy)
  return false
}

export async function canAccessSession(userId: string, session: { id: string; teamId: string | null; organizationId: string | null; createdBy: string; status: TrainingEngineSessionStatus }) {
  if (await canManageSession(userId, session)) return true
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId: session.id, userId } }, select: { status: true } })
  if (participant?.status === 'active') return session.status !== 'DRAFT'
  return false
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

async function assertScopeManagement(userId: string, input: { organizationId?: string | null; teamId?: string | null }) {
  const organizationId = input.organizationId ? String(input.organizationId) : null
  const teamId = input.teamId ? String(input.teamId) : null
  if (Boolean(organizationId) === Boolean(teamId)) throw new TrainingEngineError(422, 'TRAINING_SESSION_SCOPE_REQUIRED', '必须且只能选择一个学校或团队范围')
  if (teamId && !await isTeamAdmin(userId, teamId)) throw new TrainingEngineError(403, 'TRAINING_SESSION_FORBIDDEN', '需要团队管理员权限')
  if (organizationId && !await isOrganizationContestAdmin(userId, organizationId)) throw new TrainingEngineError(403, 'TRAINING_SESSION_FORBIDDEN', '需要学校训练管理权限')
  return { organizationId, teamId }
}


type TrainingRequestIdentity = {
  accountRole?: string | null
  organizationId?: string | null
}

function isGlobalTrainingRequest(identity: TrainingRequestIdentity) {
  return identity.accountRole === 'platform_admin' || identity.accountRole === 'super_admin'
}

export async function assertTrainingScopeContextForUser(
  identity: TrainingRequestIdentity,
  scope: { organizationId?: string | null; teamId?: string | null },
) {
  if (isGlobalTrainingRequest(identity)) return
  const organizationId = scope.organizationId ? String(scope.organizationId) : null
  const teamId = scope.teamId ? String(scope.teamId) : null
  if (organizationId && identity.organizationId !== organizationId) {
    throw new TrainingEngineError(403, 'TRAINING_SCOPE_CONTEXT_MISMATCH', '训练范围不属于当前学校上下文')
  }
  if (!teamId) return
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { scope: true, organizationId: true },
  })
  if (!team) throw new TrainingEngineError(404, 'TRAINING_TEAM_NOT_FOUND', '训练团队不存在')
  if (team.scope === 'campus') {
    if (!identity.organizationId || team.organizationId !== identity.organizationId) {
      throw new TrainingEngineError(403, 'TRAINING_SCOPE_CONTEXT_MISMATCH', '训练团队不属于当前学校上下文')
    }
  } else if (identity.organizationId) {
    throw new TrainingEngineError(403, 'TRAINING_SCOPE_CONTEXT_MISMATCH', '个人团队不能在学校上下文使用')
  }
}

export async function assertTrainingSessionContextForUser(identity: TrainingRequestIdentity, sessionId: string) {
  if (isGlobalTrainingRequest(identity)) return
  const session = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      organizationId: true,
      Team: { select: { scope: true, organizationId: true } },
    },
  })
  if (!session) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  if (session.organizationId && session.organizationId !== identity.organizationId) {
    throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  }
  if (session.Team) {
    if (session.Team.scope === 'campus') {
      if (!identity.organizationId || session.Team.organizationId !== identity.organizationId) {
        throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
      }
    } else if (identity.organizationId) {
      throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
    }
  }
}

export async function assertTrainingTemplateContextForUser(identity: TrainingRequestIdentity, templateId: string) {
  if (isGlobalTrainingRequest(identity)) return
  const template = await prisma.trainingSessionTemplate.findUnique({
    where: { id: templateId },
    select: { organizationId: true, teamId: true },
  })
  if (!template) throw new TrainingEngineError(404, 'TRAINING_TEMPLATE_NOT_FOUND', '训练模板不存在')
  try {
    await assertTrainingScopeContextForUser(identity, template)
  } catch (error) {
    if (error instanceof TrainingEngineError && ['TRAINING_SCOPE_CONTEXT_MISMATCH', 'TRAINING_TEAM_NOT_FOUND'].includes(error.code)) {
      throw new TrainingEngineError(404, 'TRAINING_TEMPLATE_NOT_FOUND', '训练模板不存在')
    }
    throw error
  }
}

export async function listTrainingSessionTemplates(userId: string, query: any) {
  const organizationId = query?.organizationId ? String(query.organizationId) : null
  const teamId = query?.teamId ? String(query.teamId) : null
  if (organizationId && !await isOrganizationMember(userId, organizationId)) throw new TrainingEngineError(404, 'TRAINING_TEMPLATE_SCOPE_NOT_FOUND', '训练模板范围不存在')
  if (teamId && !await isTeamMember(userId, teamId)) throw new TrainingEngineError(404, 'TRAINING_TEMPLATE_SCOPE_NOT_FOUND', '训练模板范围不存在')
  const templates = await prisma.trainingSessionTemplate.findMany({
    where: { status: 'active', OR: [
      { organizationId: null, teamId: null, createdBy: userId },
      ...(organizationId ? [{ organizationId, teamId: null }] : []),
      ...(teamId ? [{ teamId }] : []),
    ] },
    include: { Stages: { orderBy: { orderIndex: 'asc' } } },
    orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
  })
  return [
    ...BUILTIN_TRAINING_TEMPLATES.map(template => ({ ...template, source: 'builtin' as const })),
    ...templates.map(templateRecord),
  ]
}

function templateRecord(template: any) {
  return {
    key: `database:${template.id}`,
    name: template.name,
    sessionType: template.sessionType,
    description: template.description || '',
    source: template.organizationId ? 'organization' as const : template.teamId ? 'team' as const : 'personal' as const,
    stages: template.Stages.map((stage: any) => {
      const storedRules = parseJsonObject(stage.rules)
      const stageSettings = parseJsonObject(storedRules._templateStage)
      const { _templateGroups: _discarded, _templateStage: _discardedStage, ...rules } = storedRules
      return {
        name: stage.name,
        description: stage.description || '',
        kind: stage.kind,
        ...(stage.plannedDurationSeconds ? { plannedDurationSeconds: stage.plannedDurationSeconds } : {}),
        endPolicy: stage.endPolicy,
        accessPolicy: stage.accessPolicy,
        accessScope: normalizeTrainingAccessScope(rules.accessScope),
        submissionMode: stage.submissionMode,
        ...(stageSettings.defaultTargetScore != null ? { defaultTargetScore: stageSettings.defaultTargetScore } : {}),
        ...(stageSettings.completionThreshold != null ? { completionThreshold: stageSettings.completionThreshold } : {}),
        ...(stageSettings.minDurationSeconds != null ? { minDurationSeconds: stageSettings.minDurationSeconds } : {}),
        ...(Object.keys(rules).length ? { rules } : {}),
      }
    }),
  }
}

async function resolveTrainingTemplate(userId: string, key: unknown, scope: { organizationId: string | null; teamId: string | null }) {
  const builtin = getBuiltinTrainingTemplate(typeof key === 'string' ? key : undefined)
  if (builtin) return builtin
  if (typeof key !== 'string' || !key.startsWith('database:')) return null
  const id = key.slice('database:'.length)
  const template = await prisma.trainingSessionTemplate.findFirst({
    where: {
      id, status: 'active',
      OR: [
        { organizationId: null, teamId: null, createdBy: userId },
        ...(scope.organizationId ? [{ organizationId: scope.organizationId, teamId: null }] : []),
        ...(scope.teamId ? [{ teamId: scope.teamId }] : []),
      ],
    },
    include: { Stages: { orderBy: { orderIndex: 'asc' } } },
  })
  if (!template) throw new TrainingEngineError(404, 'TRAINING_TEMPLATE_NOT_FOUND', '训练模板不存在或当前范围不可用')
  return templateRecord(template)
}

export async function createTrainingSessionTemplate(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const name = boundedText(body?.name, 100, '模板名称', 1)
  const scope = String(body?.scope || 'personal')
  let organizationId: string | null = null
  let teamId: string | null = null
  if (scope === 'organization') {
    if (!session.organizationId || !await isOrganizationContestAdmin(userId, session.organizationId, session.createdBy)) throw new TrainingEngineError(403, 'TRAINING_TEMPLATE_SCOPE_FORBIDDEN', '无权创建学校共享模板')
    organizationId = session.organizationId
  } else if (scope === 'team') {
    if (!session.teamId || !await isTeamAdmin(userId, session.teamId)) throw new TrainingEngineError(403, 'TRAINING_TEMPLATE_SCOPE_FORBIDDEN', '无权创建团队共享模板')
    teamId = session.teamId
  } else if (scope !== 'personal') {
    throw new TrainingEngineError(422, 'TRAINING_TEMPLATE_SCOPE_INVALID', '模板范围不受支持')
  }
  const key = `custom-${crypto.randomUUID()}`
  const created = await prisma.trainingSessionTemplate.create({
    data: {
      organizationId, teamId, key, name, sessionType: session.sessionType,
      description: session.description || null, createdBy: userId,
      Stages: { create: session.Stages.map((stage, orderIndex) => {
        const unit = stage.Groups[0]
        return {
          name: stage.name, description: stage.description, orderIndex, kind: stage.kind,
          plannedDurationSeconds: unit?.plannedDurationSeconds,
          endPolicy: 'MANUAL', accessPolicy: unit?.accessPolicy || session.defaultAccessPolicy, submissionMode: unit?.submissionMode || session.defaultSubmissionMode,
          rules: asJson({ ...parseJsonObject(unit?.rules), _templateStage: { completionThreshold: unit?.completionThreshold, minDurationSeconds: unit?.minDurationSeconds } }),
        }
      }) },
    },
    include: { Stages: { orderBy: { orderIndex: 'asc' } } },
  })
  return templateRecord(created)
}

export async function deleteTrainingSessionTemplate(userId: string, templateId: string) {
  const template = await prisma.trainingSessionTemplate.findUnique({ where: { id: templateId } })
  if (!template || template.status !== 'active') throw new TrainingEngineError(404, 'TRAINING_TEMPLATE_NOT_FOUND', '训练模板不存在')
  const role = await globalRole(userId)
  const allowed = role?.role === 'super_admin' || template.createdBy === userId
    || Boolean(template.organizationId && await isOrganizationContestAdmin(userId, template.organizationId))
    || Boolean(template.teamId && await isTeamAdmin(userId, template.teamId))
  if (!allowed) throw new TrainingEngineError(403, 'TRAINING_TEMPLATE_FORBIDDEN', '无权删除该训练模板')
  await prisma.trainingSessionTemplate.update({ where: { id: templateId }, data: { status: 'retired' } })
  return { deleted: true as const }
}

type ProblemAccessContext = { userId: string; organizationId: string | null; canSeeAll: boolean }

async function problemAccessContext(userId: string, organizationId: string | null, teamId: string | null): Promise<ProblemAccessContext> {
  const [role, team] = await Promise.all([
    globalRole(userId),
    teamId ? prisma.team.findUnique({ where: { id: teamId }, select: { organizationId: true } }) : null,
  ])
  return { userId, organizationId: organizationId || team?.organizationId || null, canSeeAll: role?.role === 'super_admin' }
}

async function hydrateStages(stages: StructureStage[], access?: ProblemAccessContext) {
  if (!Array.isArray(stages) || stages.length < 1 || stages.length > 30) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', '训练必须包含 1～30 个阶段')
  const stageProblemInputs = (stage: StructureStage) => stage.problems || []
  const allProblemIds = [...new Set(stages.flatMap(stage => stageProblemInputs(stage).map(item => String(item.problemId))))]
  if (allProblemIds.length > 100) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', '一场训练最多引用 100 道不同题目')
  const requestedRevisionIds = [...new Set(stages.flatMap(stage => stageProblemInputs(stage).map(item => item.testSetRevisionId).filter((id): id is string => Boolean(id))))]
  const [problems, requestedRevisions] = await Promise.all([
    allProblemIds.length ? prisma.problem.findMany({ where: { id: { in: allProblemIds }, latestTestSetRevisionId: { not: null }, status: { not: 'archived' }, ...(access && !access.canSeeAll ? { OR: [{ ownerId: access.userId }, { libraryScope: 'platform', status: 'published' }, ...(access.organizationId ? [{ libraryScope: 'school', organizationId: access.organizationId, status: 'published' }] : [])] } : {}) }, include: { LatestTestSetRevision: { include: { Subtasks: { select: { subtaskId: true, Dependencies: { select: { DependsOn: { select: { subtaskId: true } } } } } } } }, ProblemStatement: { where: { isVisible: true }, orderBy: [{ type: 'asc' }, { format: 'asc' }, { language: 'asc' }] } } }) : [],
    requestedRevisionIds.length ? prisma.problemTestSetRevision.findMany({ where: { id: { in: requestedRevisionIds } }, include: { Subtasks: { select: { subtaskId: true, Dependencies: { select: { DependsOn: { select: { subtaskId: true } } } } } } } }) : [],
  ])
  const byId = new Map(problems.map(item => [item.id, item]))
  const revisionsById = new Map(requestedRevisions.map(item => [item.id, item]))
  return stages.map((stage, stageIndex) => {
    const name = boundedText(stage.name, 100, `阶段 ${stageIndex + 1} 名称`, 1)
    const kind = enumValue(stage.kind, STAGE_KINDS, 'TRAINING', `阶段 ${stageIndex + 1} 教学用途`)
    const endPolicy = enumValue(stage.endPolicy, END_POLICIES, 'MANUAL', `阶段 ${stageIndex + 1} 结束方式`)
    const accessPolicy = enumValue(stage.accessPolicy, ACCESS_POLICIES, 'ALL_AT_ONCE', `阶段 ${stageIndex + 1} 题目开放方式`)
    const accessScope = normalizeTrainingAccessScope(stage.accessScope ?? parseJsonObject(stage.rules).accessScope)
    const submissionMode = enumValue(stage.submissionMode, SUBMISSION_MODES, 'ENABLED', `阶段 ${stageIndex + 1} 提交方式`)
    const plannedDurationSeconds = boundedInteger(stage.plannedDurationSeconds, 60, 24 * 3600, '阶段计划时长')
    const completionThreshold = boundedInteger(stage.completionThreshold ?? (['COMPLETION', 'HYBRID'].includes(endPolicy) ? 100 : null), 1, 100, '完成比例')
    if (['TIME', 'HYBRID'].includes(endPolicy) && !plannedDurationSeconds) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', `阶段 ${stageIndex + 1} 使用${endPolicy === 'TIME' ? '按时' : '混合'}结束时必须设置计划时长`)
    if (['COMPLETION', 'HYBRID'].includes(endPolicy) && !completionThreshold) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', `阶段 ${stageIndex + 1} 使用${endPolicy === 'COMPLETION' ? '完成度' : '混合'}结束时必须设置完成比例`)
    const rawRules = parseJsonObject(stage.rules)
    const rules: Record<string, any> = {
      ...rawRules,
      accessScope,
      ...(rawRules.defaultUnlock ? { defaultUnlock: normalizeUnlockPolicy(rawRules.defaultUnlock) } : {}),
      ...(rawRules.timePolicy ? { timePolicy: normalizeProblemTimePolicy(rawRules.timePolicy) } : {}),
      ...(rawRules.stuckPolicy ? { stuckPolicy: normalizeStuckPolicy(rawRules.stuckPolicy) } : {}),
    }
    const normalizeProblem = (item: NonNullable<StructureStage['problems']>[number], problemIndex: number, label: string) => {
      const problem = byId.get(String(item.problemId))
      if (!problem?.LatestTestSetRevision) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_REVISION_REQUIRED', `${label}的第 ${problemIndex + 1} 道题没有正式 TestSet Revision`)
      const revision = item.testSetRevisionId ? revisionsById.get(item.testSetRevisionId) : problem.LatestTestSetRevision
      if (!revision || revision.problemId !== problem.id) throw new TrainingEngineError(422, 'TRAINING_REVISION_PROBLEM_MISMATCH', `${label}的第 ${problemIndex + 1} 道题使用了不属于该题的 TestSet Revision`)
      const requestedAllowedSubtaskIds = Array.isArray(item.allowedSubtaskIds) ? [...new Set(item.allowedSubtaskIds.map(Number))] : []
      if (requestedAllowedSubtaskIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new TrainingEngineError(422, 'UNKNOWN_TRAINING_SUBTASK', 'Subtask ID 必须是正整数')
      if (requestedAllowedSubtaskIds.length && revision.mode !== 'oi') throw new TrainingEngineError(422, 'SUBTASK_PROJECTION_UNSUPPORTED', '仅 OI Revision 支持按 Subtask 训练')
      const revisionSubtasks = Array.isArray((revision as any).Subtasks) ? (revision as any).Subtasks as Array<{ subtaskId: number; Dependencies: Array<{ DependsOn: { subtaskId: number } }> }> : []
      const dependencyMap = new Map(revisionSubtasks.map(subtask => [subtask.subtaskId, subtask.Dependencies.map(dependency => dependency.DependsOn.subtaskId)]))
      const closeSubtasks = (ids: number[]) => {
        const closed = new Set(ids)
        const visit = (id: number, stack = new Set<number>()) => {
          if (stack.has(id)) throw new TrainingEngineError(422, 'TRAINING_SUBTASK_DEPENDENCY_CYCLE', `Subtask ${id} 存在循环依赖`)
          const nextStack = new Set(stack); nextStack.add(id)
          for (const dependencyId of dependencyMap.get(id) || []) {
            closed.add(dependencyId)
            visit(dependencyId, nextStack)
          }
        }
        for (const id of [...closed]) visit(id)
        return [...closed].sort((a, b) => a - b)
      }
      const allowedSubtaskIds = closeSubtasks(requestedAllowedSubtaskIds)
      const rawScoreGoals = Array.isArray(item.scoreGoals) && item.scoreGoals.length ? item.scoreGoals : Array.isArray(rules.defaultScoreGoals) ? rules.defaultScoreGoals : []
      const scoreGoals = rawScoreGoals.map((goal: any, goalIndex: number) => ({
        score: boundedInteger(goal?.score, 1, 100, `${label}第 ${problemIndex + 1} 道题的第 ${goalIndex + 1} 个分数目标`, false)!,
        allowedSubtaskIds: closeSubtasks(Array.isArray(goal?.allowedSubtaskIds) ? [...new Set<number>(goal.allowedSubtaskIds.map(Number))] : []),
      }))
      if (scoreGoals.some((goal: any, index: number) => index > 0 && goal.score <= scoreGoals[index - 1].score)) throw new TrainingEngineError(422, 'INVALID_TRAINING_SCORE_GOALS', '分数目标必须严格递增')
      if (scoreGoals.some((goal: any) => goal.allowedSubtaskIds.some((id: number) => !Number.isSafeInteger(id) || id <= 0))) throw new TrainingEngineError(422, 'UNKNOWN_TRAINING_SUBTASK', '分数目标中的 Subtask ID 必须是正整数')
      let projection: string | null = null
      const allProjectedSubtasks = [...new Set([...allowedSubtaskIds, ...scoreGoals.flatMap((goal: any) => goal.allowedSubtaskIds)])]
      if (allProjectedSubtasks.length) {
        const config = yaml.load(revision.judgeConfig) as any
        const available = new Set((config?.subtasks || []).map((subtask: any) => Number(subtask.id)))
        if (allProjectedSubtasks.some(id => !available.has(id))) throw new TrainingEngineError(422, 'UNKNOWN_TRAINING_SUBTASK', `训练投影包含不存在的 Subtask：${allProjectedSubtasks.filter(id => !available.has(id)).join(', ')}`)
        if (allowedSubtaskIds.length) projection = yaml.dump({ ...config, subtasks: (config.subtasks || []).filter((subtask: any) => allowedSubtaskIds.includes(Number(subtask.id))) }, { noRefs: true, lineWidth: 120 })
      }
      return { item: {
        ...item,
        unlockPolicy: normalizeUnlockPolicy(item.unlockPolicy),
        strategyIntervalSeconds: item.strategyIntervalSeconds ?? rules.strategyIntervalSeconds,
        timePolicy: normalizeProblemTimePolicy(item.timePolicy),
        stuckPolicy: normalizeStuckPolicy(item.stuckPolicy),
        scoreGoals,
      }, problem, revision, problemIndex, allowedSubtaskIds, projection }
    }
    const allSeen = new Set<string>()
    const stageProblems = (stage.problems || []).map((item, problemIndex) => {
      const normalized = normalizeProblem(item, problemIndex, `阶段 ${stageIndex + 1}`)
      if (allSeen.has(normalized.problem.id)) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', `阶段 ${stageIndex + 1} 重复引用同一道题`)
      allSeen.add(normalized.problem.id)
      return normalized
    })
    if (rules.requiredProblemCount !== undefined) {
      const maximum = stageProblems.length
      rules.requiredProblemCount = boundedInteger(rules.requiredProblemCount, 1, Math.max(1, maximum), '阶段至少完成题数', false)
    }
    return { stage: { ...stage, kind, endPolicy, accessPolicy, accessScope, submissionMode, plannedDurationSeconds, completionThreshold, rules }, stageIndex, name, stageProblems }
  })
}

async function createStageGraph(tx: Prisma.TransactionClient, sessionId: string, entry: any) {
  const stage = await tx.trainingSessionStage.create({ data: { sessionId, name: entry.name, description: entry.stage.description?.trim() || null, orderIndex: entry.stageIndex, kind: entry.stage.kind } })
  const normalizedItems = [...entry.stageProblems]
  const uniqueItems = [...new Map(normalizedItems.map((item: any) => [item.problem.id, item])).values()] as any[]
  const stageProblemByProblemId = new Map<string, any>()
  for (const item of uniqueItems) {
    const saved = await tx.trainingSessionStageProblem.create({ data: {
      stageId: stage.id, problemId: item.problem.id, testSetRevisionId: item.revision.id,
      alias: item.item.alias?.trim() || null, orderIndex: stageProblemByProblemId.size,
      titleSnapshot: item.problem.title,
      statementsSnapshot: asJson(item.problem.ProblemStatement.map((statement: any) => ({ type: statement.type, format: statement.format, language: statement.language, content: statement.content, fileUrl: statement.fileUrl }))),
      unlockPolicy: asJson(item.item.unlockPolicy), targetScore: boundedInteger(item.item.targetScore, 0, 100, '题目目标分数'),
      scoreGoals: asJson(item.item.scoreGoals), timePolicy: asJson(item.item.timePolicy), stuckPolicy: asJson(item.item.stuckPolicy), hintPolicy: asJson(item.item.hintPolicy),
      judgeConfigProjection: item.projection, allowedSubtaskIds: item.allowedSubtaskIds.length ? item.allowedSubtaskIds : undefined,
      strategyIntervalSeconds: boundedInteger(item.item.strategyIntervalSeconds, 60, 86400, '策略检查间隔'),
    } })
    stageProblemByProblemId.set(item.problem.id, saved)
  }
  const groups = await tx.trainingSessionGroup.findMany({ where: { sessionId, status: 'active' }, orderBy: { orderIndex: 'asc' } })
  for (const group of groups) {
    const config = entry.stage
    const stageGroup = await tx.trainingSessionStageGroup.create({ data: {
      stageId: stage.id, groupId: group.id,
      mode: String(config.mode || config.trainingMode || (stage.kind === 'REVIEW' ? 'REVIEW' : 'PRACTICE')),
      accessPolicy: config.accessPolicy || entry.stage.accessPolicy, submissionMode: config.submissionMode || entry.stage.submissionMode,
      plannedDurationSeconds: entry.stage.plannedDurationSeconds, completionThreshold: entry.stage.completionThreshold,
      minDurationSeconds: boundedInteger(entry.stage.minDurationSeconds, 0, 86400, '最短阶段时长'),
      completionPolicy: asJson(config.completionPolicy), transitionPolicy: String(config.transitionPolicy || 'WAIT_FOR_TEACHER'), rules: asJson(config.rules || entry.stage.rules),
    } })
    const selected = entry.stageProblems.length ? entry.stageProblems : uniqueItems
    for (const [orderIndex, item] of selected.entries()) {
      const stageProblem = stageProblemByProblemId.get(item.problem.id)
      await tx.trainingSessionStageProblemPlan.create({ data: {
        stageId: stage.id, stageProblemId: stageProblem.id, stageGroupId: stageGroup.id, orderIndex,
        unlockPolicy: asJson(item.item.unlockPolicy), targetScore: boundedInteger(item.item.targetScore, 0, 100, '题目目标分数'), scoreGoals: asJson(item.item.scoreGoals),
        timePolicy: asJson(item.item.timePolicy), stuckPolicy: asJson(item.item.stuckPolicy), hintPolicy: asJson(item.item.hintPolicy),
        allowedSubtaskIds: item.allowedSubtaskIds.length ? item.allowedSubtaskIds : undefined, judgeConfigProjection: item.projection,
        strategyIntervalSeconds: boundedInteger(item.item.strategyIntervalSeconds, 60, 86400, '策略检查间隔'),
      } })
    }
    const participants = await tx.trainingSessionParticipant.findMany({ where: { sessionId, groupId: group.id, status: 'active' }, select: { id: true } })
    for (const participant of participants) await tx.trainingSessionStageParticipantAssignment.create({ data: { stageId: stage.id, participantId: participant.id, groupId: group.id, source: 'creation' } })
  }
  return stage
}

async function createGroupsAndParticipants(tx: Prisma.TransactionClient, sessionId: string, participantUserIds: string[], grouping: any) {
  const rawGroups = Array.isArray(grouping?.groups) && grouping.groups.length ? grouping.groups : [{ clientKey: 'default', name: '全体学员', participantIds: participantUserIds }]
  if (rawGroups.length > 50) throw new TrainingEngineError(422, 'TRAINING_GROUP_LIMIT_EXCEEDED', '一场训练最多 50 个分组')
  const assigned = new Map<string, string>()
  const groups: Array<{ id: string; name: string }> = []
  for (const [index, raw] of rawGroups.entries()) {
    const name = boundedText(raw?.name || ('第 ' + (index + 1) + ' 组'), 100, '第 ' + (index + 1) + ' 组名称', 1)
    const group = await tx.trainingSessionGroup.create({ data: { sessionId, name, orderIndex: index } })
    groups.push(group)
    const ids = [...new Set<string>((Array.isArray(raw?.participantIds) ? raw.participantIds : []).map((value: unknown) => String(value)).filter(Boolean))]
    for (const participantUserId of ids) {
      if (!participantUserIds.includes(participantUserId)) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_OUT_OF_SCOPE', '分组包含不在训练名单中的学员')
      if (assigned.has(participantUserId)) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_GROUP_DUPLICATE', '每名学员只能属于一个分组')
      assigned.set(participantUserId, group.id)
    }
  }
  if (!groups[0]) throw new TrainingEngineError(422, 'TRAINING_GROUP_REQUIRED', '训练至少需要一个分组')
  for (const userId of participantUserIds) await tx.trainingSessionParticipant.create({ data: { sessionId, userId, groupId: assigned.get(userId) || groups[0].id } })
}

export async function createTrainingSession(userId: string, body: any) {
  assertTrainingDefinitionWritesEnabled()
  const scope = await assertScopeManagement(userId, body || {})
  const template = await resolveTrainingTemplate(userId, body?.templateKey, scope)
  const sessionType = enumValue(body?.sessionType || template?.sessionType, SESSION_TYPES, 'GENERAL', '训练类型')
  const defaultAccessPolicy = enumValue(body?.defaultAccessPolicy, ACCESS_POLICIES, 'ALL_AT_ONCE', '默认题目开放方式')
  const defaultSubmissionMode = enumValue(body?.defaultSubmissionMode, SUBMISSION_MODES, 'ENABLED', '默认提交方式')
  const rankingMode = enumValue(body?.rankingMode, RANKING_MODES, 'PROGRESS_ONLY', '训练榜单方式')
  const peerVisibility = enumValue(body?.peerVisibility, PEER_VISIBILITY, 'PROGRESS', '同学状态可见性')
  const joinMode = enumValue(body?.joinMode, JOIN_MODES, 'CURRENT_STAGE', '迟到加入方式')
  const scheduledStartAt = optionalDate(body?.scheduledStartAt, '计划开始时间')
  const settings = normalizeSessionSettings(body?.settings, scheduledStartAt)
  const rawStages = Array.isArray(body?.stages) && body.stages.length ? body.stages : template?.stages || [{ name: '训练', kind: 'TRAINING', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [] }]
  const stages = rawStages.map((stage: StructureStage) => ({ ...stage, accessPolicy: stage.accessPolicy || defaultAccessPolicy, submissionMode: stage.submissionMode || defaultSubmissionMode }))
  const hydrated = await hydrateStages(stages, await problemAccessContext(userId, scope.organizationId, scope.teamId))
  const title = boundedText(body?.title, 200, '训练名称', 1)
  const id = crypto.randomUUID()
  const requestedParticipantIds = [...new Set<string>((Array.isArray(body?.participantUserIds) ? body.participantUserIds : []).map(String).filter(Boolean))]
  if (requestedParticipantIds.length > 5000) throw new TrainingEngineError(422, 'TRAINING_ROSTER_TOO_LARGE', '学员数量超过上限')
  await validateTrainingParticipantTarget(userId, scope, settings?.participantTarget, requestedParticipantIds)
  await prisma.$transaction(async tx => {
    await tx.trainingSession.create({ data: {
      id, title, description: body?.description ? boundedText(body.description, 5000, '训练说明') : null,
      sessionType: sessionType as any, ...scope, createdBy: userId, scheduledStartAt,
      defaultAccessPolicy: defaultAccessPolicy as any, defaultSubmissionMode: defaultSubmissionMode as any,
      allowHints: body?.allowHints !== false, rankingMode: rankingMode as any, peerVisibility: peerVisibility as any, joinMode: joinMode as any,
      settings: asJson(requestedParticipantIds.length ? { ...settings, rosterExplicit: true } : settings),
    } })
    await createGroupsAndParticipants(tx, id, requestedParticipantIds, body?.grouping)
    for (const entry of hydrated) await createStageGraph(tx, id, entry)
  })
  return loadSession(id)
}

export async function previewTrainingParticipants(userId: string, body: any) {
  const scope = await assertScopeManagement(userId, body || {})
  const participantIds = [...new Set<string>((Array.isArray(body?.participantUserIds) ? body.participantUserIds : []).map(String).filter(Boolean))]
  if (participantIds.length > 5000) throw new TrainingEngineError(422, 'TRAINING_ROSTER_TOO_LARGE', '学员数量超过上限')
  const target = await validateTrainingParticipantTarget(userId, scope, typeof body?.participantTarget === 'string' ? body.participantTarget : undefined, participantIds)
  const resolvedIds = target === 'custom_students' ? participantIds : await eligibleTrainingParticipantIds(scope)
  const targetRecord = scope.teamId
    ? await prisma.team.findUnique({ where: { id: scope.teamId }, select: { name: true } })
    : scope.organizationId
      ? await prisma.organization.findUnique({ where: { id: scope.organizationId }, select: { name: true } })
      : null
  return {
    participantTarget: target,
    participantCount: resolvedIds.length,
    targetName: target === 'organization_students' ? '全校学生' : target === 'custom_students' ? '自定义学生' : targetRecord?.name || '团队学生',
  }
}

function structureIssues(stages: StructureStage[]) {
  const issues: Array<{ path: string; code: string; message: string; severity: 'error' | 'warning' }> = []
  stages.forEach((stage, stageIndex) => {
    const problems = stage.problems || []
    if (String(stage.kind || 'TRAINING') === 'TRAINING' && problems.length === 0) {
      issues.push({ path: `stages.${stageIndex}.problems`, code: 'STAGE_PROBLEM_REQUIRED', message: `阶段 ${stageIndex + 1} 至少需要一道题`, severity: 'error' })
    }
    if (stage.accessPolicy === 'SEQUENTIAL') {
      problems.slice(1).forEach((problem, problemIndex) => {
        const fallback = parseJsonObject(stage.rules).defaultUnlock
        if (!problem.unlockPolicy && !fallback) issues.push({ path: `stages.${stageIndex}.problems.${problemIndex + 1}.unlockPolicy`, code: 'UNLOCK_POLICY_REQUIRED', message: `阶段 ${stageIndex + 1} 的第 ${problemIndex + 2} 道题需要解锁条件`, severity: 'error' })
      })
    }
  })
  return issues
}

export async function validateTrainingStructure(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  if (session.status === 'ENDED' || session.status === 'ARCHIVED') throw new TrainingEngineError(409, 'TRAINING_STRUCTURE_FROZEN', '已结束训练的结构不能修改')
  const stages = Array.isArray(body?.stages) ? body.stages as StructureStage[] : []
  const issues = structureIssues(stages)
  try { await hydrateStages(stages, await problemAccessContext(userId, session.organizationId, session.teamId)) } catch (error) {
    if (error instanceof TrainingEngineError) issues.push({ path: 'stages', code: error.code, message: error.message, severity: 'error' })
    else throw error
  }
  return { statusRevision: session.statusRevision, valid: !issues.some(issue => issue.severity === 'error'), issues }
}

export async function getTrainingDesign(userId: string, sessionId: string) {
  const session = await assertManage(userId, sessionId)
  const problemIds = [...new Set(session.Stages.flatMap(stage => stage.Problems.map(problem => problem.problemId)))]
  const revisionIds = [...new Set(session.Stages.flatMap(stage => stage.Problems.map(problem => problem.testSetRevisionId)))]
  const [latest, subtasks] = await Promise.all([
    problemIds.length ? prisma.problem.findMany({ where: { id: { in: problemIds } }, select: { id: true, LatestTestSetRevision: { select: { id: true, revisionNumber: true } } } }) : [],
    revisionIds.length ? prisma.problemTestSetRevisionSubtask.findMany({ where: { revisionId: { in: revisionIds } }, orderBy: [{ revisionId: 'asc' }, { orderIndex: 'asc' }], select: { revisionId: true, subtaskId: true, score: true, Dependencies: { select: { DependsOn: { select: { subtaskId: true } } } } } }) : [],
  ])
  const latestByProblem = new Map(latest.map(item => [item.id, item.LatestTestSetRevision]))
  const subtasksByRevision = new Map<string, Array<{ id: number; score: number; dependencies: number[] }>>()
  for (const item of subtasks) subtasksByRevision.set(item.revisionId, [...(subtasksByRevision.get(item.revisionId) || []), { id: item.subtaskId, score: item.score, dependencies: item.Dependencies.map(dependency => dependency.DependsOn.subtaskId) }])
  const stages = session.Stages.map((stage, stageIndex) => {
    const unit = stage.Groups[0]
    const plans = (unit?.ProblemPlans || []).slice().sort((a, b) => a.orderIndex - b.orderIndex)
    const problems = plans.map(plan => {
      const problem = stage.Problems.find(item => item.id === plan.stageProblemId)!
      return { ...problem, ...plan, id: problem.id, planId: plan.id, assignmentId: problem.id, clientKey: plan.id, latestRevision: latestByProblem.get(problem.problemId) || null, subtasks: subtasksByRevision.get(problem.testSetRevisionId) || [] }
    })
    return {
      ...stage, clientKey: stage.id, orderIndex: stageIndex,
      Problems: problems, Groups: [],
      accessPolicy: unit?.accessPolicy || session.defaultAccessPolicy,
      submissionMode: unit?.submissionMode || session.defaultSubmissionMode,
      plannedDurationSeconds: unit?.plannedDurationSeconds,
      completionThreshold: unit?.completionThreshold,
      minDurationSeconds: unit?.minDurationSeconds,
      rules: unit?.rules,
      accessScope: normalizeTrainingAccessScope(parseJsonObject(unit?.rules).accessScope),
      effectiveDurationSeconds: (unit?.plannedDurationSeconds || 0) + stage.TimeAdjustments.reduce((sum, item) => sum + item.seconds, 0),
    }
  })
  const stageGroups = session.Stages.flatMap(stage => stage.Groups.map(unit => ({
    id: unit.id, clientKey: unit.id, stageId: stage.id, stageName: stage.name, groupId: unit.groupId,
    groupName: unit.TrainingGroup.name, mode: unit.mode, accessPolicy: unit.accessPolicy, submissionMode: unit.submissionMode,
    plannedDurationSeconds: unit.plannedDurationSeconds, completionThreshold: unit.completionThreshold, minDurationSeconds: unit.minDurationSeconds,
    completionPolicy: unit.completionPolicy, transitionPolicy: unit.transitionPolicy, rules: unit.rules, status: unit.status,
    startedAt: unit.startedAt, runningSince: unit.runningSince, activeElapsedSeconds: unit.activeElapsedSeconds, endedAt: unit.endedAt, endReason: unit.endReason,
    problemIds: unit.ProblemPlans.map(item => item.stageProblemId),
  })))
  const groups = session.Groups.map(group => ({ id: group.id, clientKey: group.id, name: group.name, orderIndex: group.orderIndex, status: group.status, participantIds: group.Participants.filter(item => item.status === 'active').map(item => item.userId) }))
  const payloadStages = stages.map(stage => ({ ...stage, problems: stage.Problems })) as unknown as StructureStage[]
  return {
    editable: !['ENDED', 'ARCHIVED'].includes(session.status), statusRevision: session.statusRevision,
    session: { id: session.id, title: session.title, description: session.description, sessionType: session.sessionType, status: session.status, organizationId: session.organizationId, teamId: session.teamId, scheduledStartAt: session.scheduledStartAt, rankingMode: session.rankingMode, peerVisibility: session.peerVisibility, joinMode: session.joinMode, allowHints: session.allowHints },
    participants: session.Groups.flatMap(group => group.Participants), groups, stages, stageGroups, issues: structureIssues(payloadStages),
  }
}

export async function getTrainingDesignProblem(userId: string, sessionId: string, problemId: string) {
  const session = await assertManage(userId, sessionId)
  const team = session.teamId ? await prisma.team.findUnique({ where: { id: session.teamId }, select: { organizationId: true } }) : null
  const organizationId = session.organizationId || team?.organizationId || null
  const problem = await prisma.problem.findFirst({
    where: {
      id: problemId,
      latestTestSetRevisionId: { not: null },
      status: { not: 'archived' },
      OR: [
        { libraryScope: 'platform', status: 'published' },
        { ownerId: userId },
        ...(organizationId ? [{ libraryScope: 'school', organizationId, status: 'published' }] : []),
      ],
    },
    include: { LatestTestSetRevision: { include: { Subtasks: { orderBy: { orderIndex: 'asc' }, select: { subtaskId: true, score: true, Dependencies: { select: { DependsOn: { select: { subtaskId: true } } } } } } } } },
  })
  if (!problem?.LatestTestSetRevision) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_AVAILABLE', '题目不存在、不可用或没有正式 TestSet Revision')
  return {
    id: problem.id,
    platform: problem.platform,
    problemId: problem.problemId,
    title: problem.title,
    difficulty: problem.difficulty,
    revision: { id: problem.LatestTestSetRevision.id, revisionNumber: problem.LatestTestSetRevision.revisionNumber, mode: problem.LatestTestSetRevision.mode },
    subtasks: problem.LatestTestSetRevision.Subtasks.map(item => ({ id: item.subtaskId, score: item.score, dependencies: item.Dependencies.map(dependency => dependency.DependsOn.subtaskId) })),
  }
}

export async function replaceTrainingStructure(userId: string, sessionId: string, body: any) {
  assertTrainingDefinitionWritesEnabled()
  const session = await assertManage(userId, sessionId)
  if (['ENDED', 'ARCHIVED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_STRUCTURE_FROZEN', '已结束训练不能修改结构')
  const expectedRevision = Number(body?.expectedRevision)
  if (!Number.isSafeInteger(expectedRevision)) throw new TrainingEngineError(422, 'TRAINING_EXPECTED_REVISION_REQUIRED', '缺少有效的结构版本')
  const stages = Array.isArray(body?.stages) ? body.stages : []
  const hydrated = await hydrateStages(stages, await problemAccessContext(userId, session.organizationId, session.teamId))
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练结构已被其他管理员修改，请重新加载')
    const existing = await tx.trainingSessionStage.findMany({ where: { sessionId }, include: { Groups: { select: { status: true } } } })
    if (existing.some(stage => stage.Groups.some(unit => unit.status !== 'PENDING'))) throw new TrainingEngineError(409, 'TRAINING_STRUCTURE_FROZEN', '已有训练单元开始后只能编辑未来阶段')
    await tx.trainingSessionStage.deleteMany({ where: { sessionId } })
    for (const entry of hydrated) await createStageGraph(tx, sessionId, entry)
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
  })
  return getTrainingDesign(userId, sessionId)
}

export async function publishTrainingSession(userId: string, sessionId: string, expectedRevision: number) {
  assertTrainingDefinitionWritesEnabled()
  const session = await assertManage(userId, sessionId)
  if (session.status !== 'DRAFT') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有草稿训练可以发布')
  if (!session.Stages.length) throw new TrainingEngineError(422, 'TRAINING_STAGE_REQUIRED', '至少配置一个训练阶段')
  if (!session.Groups.some(group => group.status === 'active')) throw new TrainingEngineError(422, 'TRAINING_GROUP_REQUIRED', '至少配置一个有效分组')
  const invalidUnit = session.Stages.flatMap(stage => stage.Groups).find(unit => unit.mode !== 'REVIEW' && !unit.ProblemPlans.length)
  if (invalidUnit) throw new TrainingEngineError(422, 'TRAINING_STAGE_GROUP_EMPTY', '每个练习、考试或带练单元至少需要一道题')
  const nextStatus = session.scheduledStartAt && session.scheduledStartAt > new Date() ? 'SCHEDULED' : 'RUNNING'
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision || current.status !== 'DRAFT') throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    await tx.trainingSession.update({ where: { id: sessionId }, data: { status: nextStatus as any, statusRevision: { increment: 1 } } })
    if (nextStatus === 'RUNNING') {
      const groups = await tx.trainingSessionGroup.findMany({ where: { sessionId, status: 'active' }, select: { id: true } })
      for (const group of groups) await applyGroupRuntimeAction(tx, sessionId, group.id, 'start', userId, '发布后开始')
      await tx.trainingSession.update({ where: { id: sessionId }, data: { startedAt: new Date(), runningSince: new Date() } })
    }
  })
  return loadSession(sessionId)
}

async function appendEvent(tx: Prisma.TransactionClient, sessionId: string, type: string, targetType: TrainingEngineTargetType = 'ALL', targetId: string | null = null, payload?: unknown) {
  const session = await tx.trainingSession.update({ where: { id: sessionId }, data: { eventSeq: { increment: 1 } }, select: { eventSeq: true } })
  return tx.trainingSessionEvent.create({ data: { sessionId, seq: session.eventSeq, type, targetType, targetId, payload: asJson(payload), expiresAt: new Date(Date.now() + 7 * 24 * 3600_000) } })
}

async function normalizeCommandTarget(tx: Prisma.TransactionClient, session: { id: string; teamId: string | null }, targetType: TrainingEngineTargetType, rawTargetId: string | null) {
  if (targetType === 'ALL') return null
  if (targetType === 'TEAM') {
    if (!session.teamId || (rawTargetId && rawTargetId !== session.teamId)) throw new TrainingEngineError(422, 'INVALID_TRAINING_COMMAND_TARGET', '当前训练不属于指定团队')
    return session.teamId
  }
  if (!rawTargetId) throw new TrainingEngineError(422, 'TRAINING_COMMAND_TARGET_REQUIRED', '该教练命令必须指定目标')
  if (targetType === 'GROUP') {
    const group = await tx.trainingSessionGroup.findFirst({ where: { id: rawTargetId, sessionId: session.id, status: 'active' }, select: { id: true } })
    if (!group) throw new TrainingEngineError(422, 'TRAINING_GROUP_NOT_FOUND', '训练分组不存在')
    return group.id
  }
  const participant = await tx.trainingSessionParticipant.findFirst({ where: { sessionId: session.id, userId: rawTargetId, status: 'active' }, select: { userId: true } })
  if (!participant) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_NOT_FOUND', '学员不在当前训练')
  return participant.userId
}

function sameOverlayTarget(targetType: TrainingEngineTargetType, targetId: string | null) { return { targetType, targetId } as const }
function activeStageIncrement(value: { runningSince: Date | null }, at: Date) { return value.runningSince ? Math.max(0, Math.floor((at.getTime() - value.runningSince.getTime()) / 1000)) : 0 }

async function restoreFocusParticipants(tx: Prisma.TransactionClient, session: { id: string; teamId: string | null }, participants: Array<{ id: string; userId: string; returnProblemId: string | null }>) {
  const remaining = await tx.trainingSessionOverlay.findMany({ where: { sessionId: session.id, status: 'active', type: { in: ['SOFT_FOCUS', 'LOCKED_FOCUS', 'EXAM_FOCUS'] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { startedAt: 'asc' } })
  for (const participant of participants) {
    const activeFocus = [...remaining].reverse().find(overlay => targetApplies(overlay.targetType, overlay.targetId, participant, session))
    await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { currentProblemId: activeFocus?.stageProblemId || participant.returnProblemId, returnProblemId: null } })
  }
}

export async function resolveTrainingPermission(userId: string, sessionId: string, stageProblemId?: string | null) {
  const session = await loadSession(sessionId)
  if (!session) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'SESSION_NOT_FOUND' }
  const manager = await canManageSession(userId, session)
  if (manager) return resolveTrainingPermissionLoaded(session, true, null, stageProblemId, [], new Map())
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  if (!participant) return resolveTrainingPermissionLoaded(session, false, null, stageProblemId, [], new Map())
  const [overrides, progress] = await Promise.all([
    prisma.trainingSessionUserOverride.findMany({ where: { sessionId, userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
    prisma.trainingSessionProblemProgress.findMany({ where: { participantId: participant.id } }),
  ])
  const startedAt = performance.now()
  const context: TrainingPermissionContext = {
    session,
    manager: false,
    participant,
    overrides,
    progressByProblem: new Map(progress.map(item => [item.stageProblemId, item])),
  }
  const resolved = resolveTrainingPermissionFromContext(context, stageProblemId)
  trainingMetrics.recordPermissionLatency(performance.now() - startedAt)
  return resolved
}

export async function joinTrainingSession(userId: string, sessionId: string) {
  const session = await loadSession(sessionId)
  if (!session || session.status === 'DRAFT' || session.status === 'ENDED' || session.status === 'ARCHIVED') throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不可加入')
  const eligible = new Set(await eligibleTrainingParticipantIds(session)).has(userId)
  if (!eligible) throw new TrainingEngineError(403, 'TRAINING_SESSION_FORBIDDEN', '不在该训练的成员范围内')
  const existing = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  if (existing?.status === 'active') return existing
  if (session.joinMode === 'TEACHER_ASSIGN' || parseJsonObject(session.settings).rosterExplicit === true) throw new TrainingEngineError(409, 'TRAINING_JOIN_REQUIRES_ASSIGNMENT', '该训练需要教练将你加入名单并分配阶段')
  const defaultGroup = session.Groups.find(group => group.status === 'active')
  if (!defaultGroup) throw new TrainingEngineError(409, 'TRAINING_GROUP_REQUIRED', '训练没有可用分组')
  const participant = await prisma.trainingSessionParticipant.upsert({ where: { sessionId_userId: { sessionId, userId } }, update: { status: 'active', groupId: defaultGroup.id }, create: { sessionId, userId, groupId: defaultGroup.id } })
  await prisma.$transaction(tx => ensureV2MatrixCompleteness(tx, sessionId))
  return participant
}

export async function listTrainingSessions(userId: string, query: any, activeOrganizationId?: string | null) {
  const role = await globalRole(userId)
  if (!role || role.status !== 'active') throw new TrainingEngineError(401, 'UNAUTHENTICATED', '请先登录')
  const teamId = query?.teamId ? String(query.teamId) : null
  const requestedOrganizationId = query?.organizationId ? String(query.organizationId) : null
  const organizationId = requestedOrganizationId || (!teamId && activeOrganizationId ? activeOrganizationId : null)
  const personalWorkspace = !teamId && !organizationId && activeOrganizationId === null
  if (teamId && !await isTeamMember(userId, teamId)) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练范围不存在')
  if (organizationId && !await isOrganizationMember(userId, organizationId)) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练范围不存在')
  const scopeManager = role.role === 'super_admin' || Boolean(teamId && await isTeamAdmin(userId, teamId)) || Boolean(organizationId && await isOrganizationContestAdmin(userId, organizationId))
  const scopeWhere: Prisma.TrainingSessionWhereInput = teamId
    ? { teamId }
    : organizationId
      ? { OR: [
          { organizationId },
          role.role === 'super_admin'
            ? { Team: { organizationId } }
            : scopeManager
              ? { Team: { organizationId }, OR: [{ createdBy: userId }, { Team: { TeamMember: { some: { userId, status: 'active', role: { in: ['owner', 'admin'] } } } } }] }
              : { Team: { organizationId, TeamMember: { some: { userId, status: 'active' } } } },
        ] }
      : personalWorkspace
        ? { organizationId: null, Team: { scope: 'personal', organizationId: null } }
        : {}
  const visibilityWhere: Prisma.TrainingSessionWhereInput = scopeManager
    ? {}
    : { OR: [{ createdBy: userId }, { Participants: { some: { userId, status: 'active' } } }, ...((teamId || organizationId) ? [{ status: { in: ['SCHEDULED', 'RUNNING', 'PAUSED'] as any } }] : [])] }
  const keyword = typeof query?.keyword === 'string' ? query.keyword.trim() : ''
  const filterTeamId = typeof query?.filterTeamId === 'string' ? query.filterTeamId : ''
  const where: Prisma.TrainingSessionWhereInput = {
    AND: [scopeWhere, visibilityWhere],
    ...(keyword ? { OR: [{ title: { contains: keyword, mode: 'insensitive' } }, { description: { contains: keyword, mode: 'insensitive' } }] } : {}),
    ...(filterTeamId ? filterTeamId === 'organization' ? { teamId: null } : { teamId: filterTeamId } : {}),
  }
  const sessions = await prisma.trainingSession.findMany({ where, orderBy: [{ status: 'asc' }, { scheduledStartAt: 'desc' }, { createdAt: 'desc' }], include: { Participants: { where: { userId, status: 'active' }, select: { id: true } }, Team: { select: { name: true } }, Stages: { select: { _count: { select: { Problems: true } } } }, _count: { select: { Stages: true, Participants: true } } } })
  const visible = sessions.filter(item => {
    if (scopeManager || item.createdBy === userId || item.Participants.length) return true
    return item.joinMode !== 'TEACHER_ASSIGN' && parseJsonObject(item.settings).rosterExplicit !== true
  }).map(({ Participants, Team, Stages, ...item }) => {
    const settings = parseJsonObject(item.settings)
    return {
      ...item,
      problemCount: Stages.reduce((total, stage) => total + stage._count.Problems, 0),
      dueAt: typeof settings.dueAt === 'string' ? settings.dueAt : null,
      teamName: Team?.name || null,
      canJoin: !scopeManager && item.createdBy !== userId && !Participants.length,
    }
  })
  const groupFor = (status: string) => status === 'RUNNING' || status === 'PAUSED' ? 'active' : status === 'SCHEDULED' ? 'upcoming' : status === 'DRAFT' ? 'draft' : 'completed'
  const statusCounts = visible.reduce((counts, item) => ({ ...counts, [groupFor(item.status)]: counts[groupFor(item.status) as keyof typeof counts] + 1 }), { active: 0, upcoming: 0, draft: 0, completed: 0 })
  const requestedGroup = ['active', 'upcoming', 'draft', 'completed'].includes(String(query?.statusGroup)) ? String(query.statusGroup) : null
  const filtered = requestedGroup ? visible.filter(item => groupFor(item.status) === requestedGroup) : visible
  const wantsPage = query?.page !== undefined || query?.pageSize !== undefined || requestedGroup !== null || keyword || filterTeamId
  if (!wantsPage) return visible
  const page = Math.max(1, Number(query?.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query?.pageSize) || 20))
  const start = (page - 1) * pageSize
  return { items: filtered.slice(start, start + pageSize), statusCounts, pagination: { page, pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / pageSize) } }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}

async function createStageSnapshot(_tx: Prisma.TransactionClient, _stageId: string) {
  // V2 freezes stage definitions in the StageGroup runtime rows; no legacy snapshot table is used.
  return null
}
type StageTransitionAction = 'start' | 'advance' | 'skip_pending' | 'end_session'

async function applyV2StageTransition(tx: Prisma.TransactionClient, sessionId: string, input: { action: StageTransitionAction; stageId: string; outcome?: 'completed' | 'ended_early'; actorUserId: string | null; reason?: string | null }) {
  const session = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId }, include: { Stages: { orderBy: { orderIndex: 'asc' } }, Groups: { where: { status: 'active' }, orderBy: { orderIndex: 'asc' }, include: { StageGroups: { select: { id: true, stageId: true, status: true } } } } } })
  const stage = session.Stages.find(item => item.id === input.stageId)
  if (!stage) throw new TrainingEngineError(404, 'TRAINING_STAGE_NOT_FOUND', '阶段不存在')
  const now = new Date()
  if (input.action === 'skip_pending') {
    const pending = await tx.trainingSessionStageGroup.findMany({ where: { stageId: stage.id, status: 'PENDING' }, select: { id: true } })
    if (pending.length === 0) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_PENDING', '只能跳过尚未开始的阶段')
    if (pending.length) await tx.trainingSessionStageGroup.updateMany({ where: { id: { in: pending.map(item => item.id) } }, data: { status: 'SKIPPED', endedAt: now, endReason: input.reason || 'SKIPPED' } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    return
  }
  if (input.action === 'start') {
    if (session.status !== 'SCHEDULED') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有已发布训练可以开始')
    const firstPending = stage.orderIndex === Math.min(...session.Stages.map(item => item.orderIndex))
    if (!firstPending) throw new TrainingEngineError(409, 'TRAINING_NEXT_STAGE_INVALID', '只能启动时间轴中的第一个阶段')
    for (const group of session.Groups) await applyGroupRuntimeAction(tx, sessionId, group.id, 'start', input.actorUserId || 'system', input.reason || undefined)
    await tx.trainingSession.update({ where: { id: sessionId }, data: { status: 'RUNNING', startedAt: session.startedAt || now, runningSince: now, pausedAt: null, pauseMode: null, statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, sessionId, TrainingEventTypes.SESSION_STARTED, 'ALL', null, { stageId: stage.id, v2: true })
    return
  }
  const activeUnits = await tx.trainingSessionStageGroup.findMany({ where: { stageId: stage.id, status: { in: ['RUNNING', 'PAUSED'] } }, select: { id: true, status: true, runningSince: true } })
  if (!activeUnits.length) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '当前阶段没有运行中的训练组')
  if (input.action === 'end_session') {
    for (const unit of activeUnits) {
      const elapsed = unit.status === 'RUNNING' && unit.runningSince ? Math.max(0, Math.floor((now.getTime() - unit.runningSince.getTime()) / 1000)) : 0
      await tx.trainingSessionStageGroup.update({ where: { id: unit.id }, data: { status: 'ENDED', runningSince: null, activeElapsedSeconds: { increment: elapsed }, endedAt: now, endReason: input.reason || (input.outcome === 'ended_early' ? 'TEACHER_ENDED_EARLY' : 'SESSION_ENDED') } })
    }
    await tx.trainingSession.update({ where: { id: sessionId }, data: { status: 'ENDED', endedAt: now, runningSince: null, pausedAt: null, pauseMode: null, statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, sessionId, TrainingEventTypes.SESSION_ENDED, 'ALL', null, { stageId: stage.id, v2: true, reason: input.reason || null })
    return
  }
  for (const unit of activeUnits) {
    const group = session.Groups.find(candidate => candidate.StageGroups?.some((item: any) => item.id === unit.id))
    if (group) await applyGroupRuntimeAction(tx, sessionId, group.id, 'advance', input.actorUserId || 'system', input.reason || undefined)
  }
  await tx.trainingSession.update({ where: { id: sessionId }, data: { status: session.status === 'PAUSED' ? 'PAUSED' : 'RUNNING', statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
  await appendEvent(tx, sessionId, TrainingEventTypes.STAGE_ADVANCED, 'ALL', null, { stageId: stage.id, v2: true, reason: input.reason || null })
}

export async function executeStageTransition(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
    const expectedRevision = Number(body?.expectedRevision)
  if (!Number.isInteger(expectedRevision) || expectedRevision !== session.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
  const action = String(body?.action || '').toLowerCase() as StageTransitionAction
  if (!['start', 'advance', 'skip_pending', 'end_session'].includes(action)) throw new TrainingEngineError(422, 'INVALID_TRAINING_STAGE_TRANSITION', '不支持的阶段转换')
  const reason = body?.reason ? boundedText(body.reason, 2000, '转换原因', 1) : null
  const outcome = String(body?.outcome || 'completed').toLowerCase() as 'completed' | 'ended_early'
  if ((action === 'skip_pending' || outcome === 'ended_early') && !reason) throw new TrainingEngineError(422, 'TRAINING_STAGE_REASON_REQUIRED', '提前结束或跳过阶段必须填写原因')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId }, select: { statusRevision: true } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    await applyV2StageTransition(tx, sessionId, { action, stageId: String(body?.stageId || ''), outcome, actorUserId: userId, reason })
  })
  return getTrainingWorkspace(userId, sessionId)
  return getTrainingWorkspace(userId, sessionId)
}


export async function endTrainingStage(userId: string, sessionId: string, stageId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  if (!Number.isInteger(expectedRevision) || expectedRevision !== session.statusRevision) {
    throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新后重试')
  }
  if (!['RUNNING', 'PAUSED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '只能结束运行中的阶段')
  const current = session.Stages.find(stage => stage.id === stageId)
  if (!current || !current.Groups.some(group => ['RUNNING', 'PAUSED'].includes(group.status))) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '当前阶段没有运行中的训练组')
  const next = session.Stages.find(stage => stage.orderIndex > current.orderIndex && stage.Groups.some(group => group.status === 'PENDING'))
  const outcome = body?.outcome === 'ended_early' ? 'ended_early' : 'completed'
  const action = body?.endSession === true || !next ? 'end_session' : 'advance'
  return executeStageTransition(userId, sessionId, {
    expectedRevision,
    action,
    stageId,
    outcome,
    ...(action === 'advance' && next ? { nextStageId: next.id } : {}),
    ...(body?.reason ? { reason: String(body.reason) } : {}),
  })
}

export async function cloneTrainingStage(userId: string, sessionId: string, stageId: string, body: any) {
  assertTrainingDefinitionWritesEnabled()
  await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  let cloneId = ''
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    const source = await tx.trainingSessionStage.findFirst({ where: { id: stageId, sessionId }, include: { Problems: { include: { Hints: true } }, Groups: { include: { ProblemPlans: true } } } })
    if (!source) throw new TrainingEngineError(404, 'TRAINING_STAGE_NOT_FOUND', '阶段不存在')
    const maxOrder = await tx.trainingSessionStage.aggregate({ where: { sessionId }, _max: { orderIndex: true } })
    const clone = await tx.trainingSessionStage.create({ data: { sessionId, name: boundedText(body?.name || `${source.name}（复制）`, 200, '阶段名称', 1), description: source.description, orderIndex: (maxOrder._max.orderIndex ?? -1) + 1, kind: source.kind } })
    cloneId = clone.id
    const problemMap = new Map<string, string>()
    for (const problem of source.Problems.sort((a,b)=>a.orderIndex-b.orderIndex)) {
      const created = await tx.trainingSessionStageProblem.create({ data: { stageId: clone.id, problemId: problem.problemId, testSetRevisionId: problem.testSetRevisionId, alias: problem.alias, orderIndex: problem.orderIndex, titleSnapshot: problem.titleSnapshot, statementsSnapshot: asJson(problem.statementsSnapshot), unlockPolicy: asJson(problem.unlockPolicy), targetScore: problem.targetScore, timePolicy: asJson(problem.timePolicy), stuckPolicy: asJson(problem.stuckPolicy), hintPolicy: asJson(problem.hintPolicy), judgeConfigProjection: problem.judgeConfigProjection, allowedSubtaskIds: asJson(problem.allowedSubtaskIds), strategyIntervalSeconds: problem.strategyIntervalSeconds, scoreGoals: asJson(problem.scoreGoals) } })
      problemMap.set(problem.id, created.id)
    }
    for (const unit of source.Groups) {
      const createdUnit = await tx.trainingSessionStageGroup.create({ data: { stageId: clone.id, groupId: unit.groupId, mode: unit.mode, accessPolicy: unit.accessPolicy, submissionMode: unit.submissionMode, rules: asJson(unit.rules), plannedDurationSeconds: unit.plannedDurationSeconds, completionThreshold: unit.completionThreshold, minDurationSeconds: unit.minDurationSeconds, completionPolicy: asJson(unit.completionPolicy), transitionPolicy: unit.transitionPolicy } })
      for (const plan of unit.ProblemPlans.sort((a,b)=>a.orderIndex-b.orderIndex)) await tx.trainingSessionStageProblemPlan.create({ data: { stageId: clone.id, stageProblemId: problemMap.get(plan.stageProblemId)!, stageGroupId: createdUnit.id, orderIndex: plan.orderIndex, unlockPolicy: asJson(plan.unlockPolicy), targetScore: plan.targetScore, scoreGoals: asJson(plan.scoreGoals), timePolicy: asJson(plan.timePolicy), stuckPolicy: asJson(plan.stuckPolicy), hintPolicy: asJson(plan.hintPolicy), allowedSubtaskIds: asJson(plan.allowedSubtaskIds), judgeConfigProjection: plan.judgeConfigProjection, strategyIntervalSeconds: plan.strategyIntervalSeconds, rules: asJson(plan.rules) } })
    }
    const participants = await tx.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, select: { id: true, groupId: true } })
    for (const participant of participants) await tx.trainingSessionStageParticipantAssignment.create({ data: { stageId: clone.id, participantId: participant.id, groupId: participant.groupId, assignedBy: userId, source: 'stage-clone' } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
  })
  return { stageId: cloneId, design: await getTrainingDesign(userId, sessionId) }
}

export async function moveTrainingStageParticipant(userId: string, sessionId: string, _stageId: string, body: any) {
  await changeTrainingGrouping(userId, sessionId, body)
  return getTrainingWorkspace(userId, sessionId)
}

export async function getTrainingStageGroupSuggestions(userId: string, sessionId: string, _stageId: string) {
  const grouping = await getTrainingGrouping(userId, sessionId)
  return { suggestions: grouping.groups.map((group: any) => ({ groupId: group.id, groupName: group.name, participantIds: group.participantIds, reason: '保持当前稳定分组' })) }
}

export async function changeTrainingStageGroup(userId: string, sessionId: string, _stageId: string, body: any) {
  await changeTrainingGrouping(userId, sessionId, body)
  return getTrainingWorkspace(userId, sessionId)
}

export async function extendTrainingStageTime(userId: string, sessionId: string, stageId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  const seconds = boundedInteger(body?.seconds, 60, 24 * 3600, '延长时长', false)!
  const reason = boundedText(body?.reason, 2000, '延时原因', 1)
  if (expectedRevision !== session.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '当前阶段已变化，请刷新')
    const stage = await tx.trainingSessionStage.findFirst({ where: { id: stageId, sessionId, Groups: { some: { status: { in: ['RUNNING', 'PAUSED'] } } } } })
    if (!stage) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '只能延长当前运行阶段')
    await tx.trainingSessionStageTimeAdjustment.create({ data: { stageId, seconds, reason, createdBy: userId } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, sessionId, TrainingEventTypes.STAGE_TIME_EXTENDED, 'ALL', null, { stageId, seconds, reason })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function getTrainingWorkspace(userId: string, sessionId: string) {
  const session = await loadSession(sessionId)
  if (!session) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  const manager = await canManageSession(userId, session)
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  if (!manager && (participant?.status !== 'active' || session.status === 'DRAFT')) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  const [progress, overrides] = await Promise.all([
    participant ? prisma.trainingSessionProblemProgress.findMany({ where: { participantId: participant.id } }) : Promise.resolve([]),
    participant && !manager ? prisma.trainingSessionUserOverride.findMany({ where: { sessionId, userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }) : Promise.resolve([]),
  ])
  const currentGroup = participant ? session.Groups.find(group => group.id === participant.groupId) : null
  const activeUnit = currentGroup?.StageGroups.find(unit => ['RUNNING', 'PAUSED'].includes(unit.status)) || null
  const participantView = participant ? { ...participant, currentGroupId: participant.groupId, activeStageId: activeUnit?.stageId || null } : null
  const progressByProblem = new Map(progress.map(item => [item.stageProblemId, item]))
  const permissionContext: TrainingPermissionContext = { session: session as any, manager, participant: participantView, overrides, progressByProblem }
  const resolvedPermissions = resolveAllTrainingPermissions(permissionContext)
  const permissions = Object.fromEntries(Object.entries(resolvedPermissions).map(([stageProblemId, permission]) => [stageProblemId, { ...permission, canSeeMetadata: manager || permission.canView }]))
  const requirements = participant ? resolveParticipantSessionRequirements(session as any, participant.id, progress) : []
  const visibleOverlays = manager || !participantView ? session.Overlays : session.Overlays.filter(overlay => targetApplies(overlay.targetType, overlay.targetId, participantView, session))
  const snapshotProblem = (problem: any) => ({ ...problem, Problem: { ...problem.Problem, title: problem.titleSnapshot }, Statements: Array.isArray(problem.statementsSnapshot) ? problem.statementsSnapshot : [] })
  const snapshotStage = (stage: any) => ({ ...stage, Groups: stage.Groups.map((unit: any) => ({ ...unit, name: unit.TrainingGroup.name })), Problems: stage.Problems.map((problem: any) => manager || permissions[problem.id]?.canSeeMetadata ? snapshotProblem(problem) : { ...snapshotProblem(problem), alias: null, Statements: [], Problem: { ...problem.Problem, platform: '', problemId: '', title: '未开放题目', difficulty: null } }) })
  return {
    session: { ...session, Stages: session.Stages.map(snapshotStage), Overlays: visibleOverlays, activeUnits: session.Groups.flatMap(group => group.StageGroups.filter(unit => ['RUNNING', 'PAUSED'].includes(unit.status)).map(unit => ({ groupId: group.id, stageId: unit.stageId, status: unit.status }))) },
    manager,
    participant: participantView ? { ...participantView, requirements: requirements.map(item => ({ stageId: item.stageId, stageProblemId: item.stageProblemId, state: item.state })) } : null,
    progress, permissions, strategy: {},
  }
}

export async function replaceTrainingRoster(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  if (expectedRevision !== session.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练名单已变化，请刷新')
  const participants = Array.isArray(body?.participants) ? body.participants : []
  if (participants.length > 5000) throw new TrainingEngineError(422, 'TRAINING_ROSTER_TOO_LARGE', '学员数量超过上限')
  const eligible = new Set(await eligibleTrainingParticipantIds(session))
  const userIds = [...new Set<string>(participants.map((item: any) => String(item.userId || '')).filter(Boolean))]
  if (userIds.some(id => !eligible.has(id))) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_OUT_OF_SCOPE', '名单中包含不属于当前学校或团队的账号')
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练名单已变化，请刷新')
    const defaultGroup = await tx.trainingSessionGroup.findFirst({ where: { sessionId, status: 'active' }, orderBy: { orderIndex: 'asc' } })
    if (!defaultGroup) throw new TrainingEngineError(422, 'TRAINING_GROUP_REQUIRED', '训练至少需要一个有效分组')
    await tx.trainingSessionParticipant.updateMany({ where: { sessionId, userId: { notIn: userIds }, status: 'active' }, data: { status: 'removed' } })
    for (const participantUserId of userIds) await tx.trainingSessionParticipant.upsert({
      where: { sessionId_userId: { sessionId, userId: participantUserId } },
      update: { status: 'active', currentProblemId: null, returnProblemId: null },
      create: { sessionId, userId: participantUserId, groupId: defaultGroup.id },
    })
    await ensureV2MatrixCompleteness(tx, sessionId)
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 }, settings: asJson({ ...parseJsonObject(session.settings), rosterExplicit: true }) } })
    await appendEvent(tx, sessionId, TrainingEventTypes.ROSTER_UPDATED, 'ALL', null, { participantCount: userIds.length })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function getTrainingRoster(userId: string, sessionId: string) {
  const session = await assertManage(userId, sessionId)
  const eligible = session.teamId
    ? await prisma.teamMember.findMany({ where: { teamId: session.teamId, status: 'active', userType: 'student' }, include: { User: { select: { id: true, username: true, avatar: true } } }, orderBy: { joinedAt: 'asc' } })
    : await prisma.organizationMembership.findMany({ where: { organizationId: session.organizationId!, status: 'active', memberRole: 'student' }, include: { User: { select: { id: true, username: true, avatar: true } }, StudentProfile: { select: { name: true } }, TeacherProfile: { select: { name: true } } }, orderBy: { createdAt: 'asc' } })
  const participants = await prisma.trainingSessionParticipant.findMany({ where: { sessionId }, select: { userId: true, status: true } })
  const byUser = new Map(participants.map(item => [item.userId, item]))
  return {
    revision: session.statusRevision,
    candidates: eligible.map((item: any) => ({ userId: item.userId, username: item.User.username, avatar: item.User.avatar, displayName: item.StudentProfile?.name || item.TeacherProfile?.name || item.User.username, role: item.memberRole || item.role, selected: byUser.get(item.userId)?.status === 'active' })),
  }
}

function serializeV2Grouping(session: any) {
  return {
    groups: (session.Groups || []).map((group: any) => ({
      id: group.id,
      clientKey: group.id,
      name: group.name,
      orderIndex: group.orderIndex,
      status: group.status,
      participantIds: (group.Participants || []).filter((item: any) => item.status === 'active').map((item: any) => item.userId),
    })),
    memberships: (session.Groups || []).flatMap((group: any) => (group.Participants || []).filter((item: any) => item.status === 'active').map((item: any) => ({
      participantId: item.id,
      userId: item.userId,
      groupId: group.id,
      groupName: group.name,
    }))),
  }
}

export async function getTrainingGrouping(userId: string, sessionId: string) {
  const session = await assertManage(userId, sessionId)
  return serializeV2Grouping(session)
}

async function ensureV2MatrixCompleteness(tx: Prisma.TransactionClient, sessionId: string) {
  const session = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId }, select: { defaultAccessPolicy: true, defaultSubmissionMode: true } })
  const stages = await tx.trainingSessionStage.findMany({
    where: { sessionId },
    include: { Groups: { include: { ProblemPlans: true } }, Problems: true },
    orderBy: { orderIndex: 'asc' },
  })
  const groups = await tx.trainingSessionGroup.findMany({ where: { sessionId, status: 'active' }, orderBy: { orderIndex: 'asc' } })
  for (const stage of stages) {
    const source = stage.Groups[0]
    for (const group of groups) {
      let stageGroup: any = stage.Groups.find(item => item.groupId === group.id)
      if (!stageGroup) {
        stageGroup = await tx.trainingSessionStageGroup.create({ data: {
          stageId: stage.id, groupId: group.id,
          mode: source?.mode || (stage.kind === 'REVIEW' ? 'REVIEW' : 'PRACTICE'),
          accessPolicy: source?.accessPolicy || session.defaultAccessPolicy,
          submissionMode: source?.submissionMode || session.defaultSubmissionMode,
          plannedDurationSeconds: source?.plannedDurationSeconds,
          completionThreshold: source?.completionThreshold,
          minDurationSeconds: source?.minDurationSeconds,
          completionPolicy: asJson(source?.completionPolicy),
          transitionPolicy: source?.transitionPolicy || 'WAIT_FOR_TEACHER',
          rules: asJson(source?.rules),
        } })
        const basePlans = source?.ProblemPlans?.length ? source.ProblemPlans : stage.Problems
        for (const [orderIndex, base] of basePlans.entries()) await tx.trainingSessionStageProblemPlan.create({ data: {
          stageId: stage.id,
          stageProblemId: 'stageProblemId' in base ? base.stageProblemId : base.id,
          stageGroupId: stageGroup.id,
          orderIndex,
          unlockPolicy: asJson(base.unlockPolicy), targetScore: base.targetScore, scoreGoals: asJson(base.scoreGoals),
          timePolicy: asJson(base.timePolicy), stuckPolicy: asJson(base.stuckPolicy), hintPolicy: asJson(base.hintPolicy),
          allowedSubtaskIds: asJson(base.allowedSubtaskIds), judgeConfigProjection: base.judgeConfigProjection,
          strategyIntervalSeconds: base.strategyIntervalSeconds,
          ...('rules' in base ? { rules: asJson(base.rules) } : {}),
        } })
      }
    }
    const participants = await tx.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, select: { id: true, groupId: true } })
    for (const participant of participants) await tx.trainingSessionStageParticipantAssignment.upsert({
      where: { stageId_participantId: { stageId: stage.id, participantId: participant.id } },
      update: { groupId: participant.groupId },
      create: { stageId: stage.id, participantId: participant.id, groupId: participant.groupId, source: 'matrix-finalize' },
    })
  }
}

export async function replaceTrainingGrouping(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  if (!['DRAFT', 'SCHEDULED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_GROUPING_FROZEN', '训练开始后请使用拆组、合组或调组操作')
  const expectedRevision = Number(body?.expectedRevision)
  const rawGroups = Array.isArray(body?.groups) ? body.groups : []
  if (!rawGroups.length || rawGroups.length > 50) throw new TrainingEngineError(422, 'TRAINING_GROUP_REQUIRED', '训练至少需要一个分组')
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练已被其他管理员修改，请刷新')
    const participants = await tx.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, select: { id: true, userId: true } })
    const byUser = new Map(participants.map(item => [item.userId, item.id]))
    const oldGroups = await tx.trainingSessionGroup.findMany({ where: { sessionId } })
    const oldById = new Map(oldGroups.map(group => [group.id, group]))
    const savedGroupIds: string[] = []
    const assigned = new Set<string>()
    for (const [index, raw] of rawGroups.entries()) {
      const name = boundedText(raw?.name, 100, '分组名称', 1)
      const userIds = [...new Set<string>((Array.isArray(raw?.participantIds) ? raw.participantIds : []).map((value: unknown) => String(value)))]
      for (const participantUserId of userIds) {
        if (!byUser.has(participantUserId)) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_OUT_OF_SCOPE', '分组包含不在训练名单中的学员')
        if (assigned.has(participantUserId)) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_GROUP_DUPLICATE', '每名学员只能属于一个分组')
        assigned.add(participantUserId)
      }
      const existing = raw?.id ? oldById.get(String(raw.id)) : null
      const group = existing
        ? await tx.trainingSessionGroup.update({ where: { id: existing.id }, data: { name, orderIndex: index, status: 'active' } })
        : await tx.trainingSessionGroup.create({ data: { sessionId, name, orderIndex: index } })
      savedGroupIds.push(group.id)
      await tx.trainingSessionParticipant.updateMany({ where: { id: { in: userIds.map(item => byUser.get(item)!).filter(Boolean) } }, data: { groupId: group.id } })
    }
    const fallbackId = savedGroupIds[0]
    await tx.trainingSessionParticipant.updateMany({ where: { sessionId, status: 'active', userId: { notIn: [...assigned] } }, data: { groupId: fallbackId } })
    await tx.trainingSessionGroup.updateMany({ where: { sessionId, id: { notIn: savedGroupIds } }, data: { status: 'retired' } })
    await ensureV2MatrixCompleteness(tx, sessionId)
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
  })
  return getTrainingGrouping(userId, sessionId)
}

export async function replaceTrainingStageGroupMatrix(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  const stageGroups = Array.isArray(body?.stageGroups) ? body.stageGroups : []
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练已被其他管理员修改，请刷新')
    const stages = await tx.trainingSessionStage.findMany({ where: { sessionId }, include: { Problems: true, Groups: { include: { ProblemPlans: true } } } })
    const groups = await tx.trainingSessionGroup.findMany({ where: { sessionId, status: 'active' } })
    if (stageGroups.length !== stages.length * groups.length) throw new TrainingEngineError(422, 'TRAINING_STAGE_GROUP_MATRIX_INCOMPLETE', '每个有效 Stage × Group 必须有且仅有一个训练单元')
    const stageById = new Map(stages.map(stage => [stage.id, stage]))
    const groupById = new Map(groups.map(group => [group.id, group]))
    const seen = new Set<string>()
    for (const raw of stageGroups) {
      const stage = stageById.get(String(raw.stageId))
      const group = groupById.get(String(raw.groupId))
      if (!stage || !group) throw new TrainingEngineError(422, 'TRAINING_STAGE_GROUP_INVALID', '训练单元引用了无效阶段或分组')
      const key = stage.id + ':' + group.id
      if (seen.has(key)) throw new TrainingEngineError(422, 'TRAINING_STAGE_GROUP_DUPLICATE', 'Stage × Group 训练单元重复')
      seen.add(key)
      const stageGroup = stage.Groups.find(item => item.groupId === group.id)
      if (!stageGroup) throw new TrainingEngineError(422, 'TRAINING_STAGE_GROUP_REQUIRED', 'Stage × Group 训练单元缺失')
      if (stageGroup.status !== 'PENDING') continue
      const mode = String(raw.mode || raw.trainingMode || 'PRACTICE')
      if (!['PRACTICE', 'EXAM', 'GUIDED', 'REVIEW'].includes(mode)) throw new TrainingEngineError(422, 'TRAINING_MODE_INVALID', '训练方式不受支持')
      const requested: string[] = [...new Set<string>((Array.isArray(raw.problemIds) ? raw.problemIds : []).map((value: unknown) => String(value)))]
      if (mode !== 'REVIEW' && !requested.length) throw new TrainingEngineError(422, 'TRAINING_STAGE_GROUP_EMPTY', '练习、考试或带练单元至少需要一道题')
      const validIds = new Set(stage.Problems.map(problem => problem.id))
      if (requested.some(id => !validIds.has(id))) throw new TrainingEngineError(422, 'TRAINING_STAGE_GROUP_PROBLEM_INVALID', '训练单元引用了不属于当前阶段的题目')
      const byProblem = new Map(stageGroup.ProblemPlans.map(item => [item.stageProblemId, item]))
      await tx.trainingSessionStageProblemPlan.deleteMany({ where: { stageGroupId: stageGroup.id } })
      for (const [index, problemId] of requested.entries()) {
        const base = byProblem.get(problemId) || await tx.trainingSessionStageProblemPlan.findFirst({ where: { stageId: stage.id, stageProblemId: problemId } })
        await tx.trainingSessionStageProblemPlan.create({ data: {
          stageId: stage.id,
          stageProblemId: problemId,
          stageGroupId: stageGroup.id,
          orderIndex: index,
          unlockPolicy: asJson(base?.unlockPolicy),
          targetScore: base?.targetScore,
          scoreGoals: asJson(base?.scoreGoals),
          timePolicy: asJson(base?.timePolicy),
          stuckPolicy: asJson(base?.stuckPolicy),
          hintPolicy: asJson(base?.hintPolicy),
          allowedSubtaskIds: asJson(base?.allowedSubtaskIds),
          judgeConfigProjection: base?.judgeConfigProjection,
          strategyIntervalSeconds: base?.strategyIntervalSeconds,
          rules: asJson(raw.rules || base?.rules),
        } })
      }
      await tx.trainingSessionStageGroup.update({ where: { id: stageGroup.id }, data: {
        mode,
        completionPolicy: asJson(raw.completionPolicy),
        transitionPolicy: String(raw.transitionPolicy || 'WAIT_FOR_TEACHER'),
        rules: asJson(raw.rules),
      } })
    }
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
  })
  return getTrainingDesign(userId, sessionId)
}

export async function changeTrainingGrouping(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  const reason = boundedText(body?.reason, 2000, '换组原因', 1)
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    const participant = await tx.trainingSessionParticipant.findFirst({ where: { sessionId, id: String(body?.participantId || ''), status: 'active' } })
    const toGroup = await tx.trainingSessionGroup.findFirst({ where: { sessionId, id: String(body?.toGroupId || ''), status: 'active' } })
    if (!participant) throw new TrainingEngineError(404, 'TRAINING_PARTICIPANT_NOT_FOUND', '学员不属于当前训练')
    if (!toGroup) throw new TrainingEngineError(404, 'TRAINING_GROUP_NOT_FOUND', '目标分组不存在')
    if (participant.groupId === toGroup.id) return
    await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { groupId: toGroup.id, currentProblemId: null } })
    await tx.trainingSessionGroupChange.create({ data: { sessionId, participantId: participant.id, fromGroupId: participant.groupId, toGroupId: toGroup.id, reason, changedBy: userId } })
    const activeTarget = await tx.trainingSessionStageGroup.findFirst({ where: { groupId: toGroup.id, status: { in: ['RUNNING', 'PAUSED'] } } })
    if (activeTarget) await tx.trainingSessionStageParticipantAssignment.upsert({
      where: { stageId_participantId: { stageId: activeTarget.stageId, participantId: participant.id } },
      update: { groupId: toGroup.id, assignedAt: new Date(), assignedBy: userId, source: 'group-change-v2' },
      create: { stageId: activeTarget.stageId, participantId: participant.id, groupId: toGroup.id, assignedBy: userId, source: 'group-change-v2' },
    })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
  })
  return getTrainingGrouping(userId, sessionId)
}

async function applyGroupRuntimeAction(
  tx: Prisma.TransactionClient,
  sessionId: string,
  groupId: string,
  action: 'start' | 'advance' | 'pause' | 'resume',
  actorId: string,
  reason?: string,
) {
  const now = new Date()
  const group = await tx.trainingSessionGroup.findFirst({
    where: { id: groupId, sessionId, status: 'active' },
    include: { Participants: { where: { status: 'active' }, select: { id: true } } },
  })
  if (!group) throw new TrainingEngineError(404, 'TRAINING_GROUP_NOT_FOUND', '训练分组不存在')
  const units = await tx.trainingSessionStageGroup.findMany({
    where: { groupId },
    include: { Stage: { select: { id: true, orderIndex: true } }, ProblemPlans: true },
    orderBy: { Stage: { orderIndex: 'asc' } },
  })
  if (!units.length) throw new TrainingEngineError(422, 'TRAINING_STAGE_REQUIRED', '当前分组没有训练阶段')
  const active = units.find(item => ['RUNNING', 'PAUSED'].includes(item.status))
  if (action === 'pause') {
    if (!active || active.status !== 'RUNNING') throw new TrainingEngineError(409, 'TRAINING_GROUP_NOT_RUNNING', '只有运行中的分组可以暂停')
    const elapsed = active.runningSince ? Math.max(0, Math.floor((now.getTime() - active.runningSince.getTime()) / 1000)) : 0
    await tx.trainingSessionStageGroup.update({ where: { id: active.id }, data: { status: 'PAUSED', runningSince: null, activeElapsedSeconds: { increment: elapsed } } })
    return
  }
  if (action === 'resume') {
    if (!active || active.status !== 'PAUSED') throw new TrainingEngineError(409, 'TRAINING_GROUP_NOT_PAUSED', '只有暂停中的分组可以恢复')
    await tx.trainingSessionStageGroup.update({ where: { id: active.id }, data: { status: 'RUNNING', runningSince: now } })
    return
  }
  if (action === 'start' && active) throw new TrainingEngineError(409, 'TRAINING_GROUP_ALREADY_STARTED', '该分组已经开始训练')
  if (action === 'advance' && !active) throw new TrainingEngineError(409, 'TRAINING_GROUP_NOT_STARTED', '该分组没有正在运行的阶段')
  const target = action === 'start'
    ? units.find(item => item.status === 'PENDING')
    : units.find(item => item.Stage.orderIndex > active!.Stage.orderIndex && item.status === 'PENDING')
  if (active) {
    const elapsed = active.runningSince ? Math.max(0, Math.floor((now.getTime() - active.runningSince.getTime()) / 1000)) : 0
    await tx.trainingSessionStageGroup.update({ where: { id: active.id }, data: {
      status: 'ENDED',
      runningSince: null,
      activeElapsedSeconds: { increment: elapsed },
      endedAt: now,
      endReason: reason || 'ADVANCED',
    } })
  }
  if (!target) return
  if (target.mode !== 'REVIEW' && !target.ProblemPlans.length) throw new TrainingEngineError(422, 'TRAINING_STAGE_GROUP_EMPTY', '目标训练单元必须至少包含一道题')
  await tx.trainingSessionStageGroup.update({ where: { id: target.id }, data: {
    status: 'RUNNING',
    startedAt: target.startedAt || now,
    runningSince: now,
    activeElapsedSeconds: 0,
  } })
  for (const participant of group.Participants) {
    await tx.trainingSessionStageParticipantAssignment.upsert({
      where: { stageId_participantId: { stageId: target.stageId, participantId: participant.id } },
      update: { groupId, assignedAt: now, assignedBy: actorId, source: 'group-runtime-v2' },
      create: { stageId: target.stageId, participantId: participant.id, groupId, assignedBy: actorId, source: 'group-runtime-v2' },
    })
  }
}

export async function executeTrainingGroupRuntimeAction(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  const action = String(body?.action || '') as 'start' | 'advance' | 'pause' | 'resume'
  if (!['start', 'advance', 'pause', 'resume'].includes(action)) throw new TrainingEngineError(422, 'TRAINING_GROUP_ACTION_INVALID', '分组运行操作不受支持')
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    await applyGroupRuntimeAction(tx, sessionId, String(body.groupId), action, userId, body.reason ? String(body.reason) : undefined)
    await tx.trainingSession.update({ where: { id: sessionId }, data: { status: action === 'start' ? 'RUNNING' : current.status, startedAt: action === 'start' ? current.startedAt || new Date() : current.startedAt, statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'GROUP_RUNTIME_CHANGED', 'GROUP', String(body.groupId), { action, reason: body.reason || null })
  })
  return getTrainingWorkspace(userId, sessionId)
}
export async function executeTrainingGroupRuntimeBatch(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  const actionMap: Record<string, 'start' | 'advance' | 'pause' | 'resume'> = { start_all: 'start', advance_all: 'advance', pause_all: 'pause', resume_all: 'resume' }
  const action = actionMap[String(body?.action || '')]
  if (!action) throw new TrainingEngineError(422, 'TRAINING_GROUP_ACTION_INVALID', '批量运行操作不受支持')
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    const groups = await tx.trainingSessionGroup.findMany({ where: { sessionId, status: 'active' }, include: { StageGroups: true }, orderBy: { orderIndex: 'asc' } })
    const eligible = groups.filter(group => {
      const active = group.StageGroups.find(item => ['RUNNING', 'PAUSED'].includes(item.status))
      return action === 'start' ? !active : action === 'advance' ? Boolean(active) : action === 'pause' ? active?.status === 'RUNNING' : active?.status === 'PAUSED'
    })
    for (const group of eligible) await applyGroupRuntimeAction(tx, sessionId, group.id, action, userId, body.reason ? String(body.reason) : undefined)
    await tx.trainingSession.update({ where: { id: sessionId }, data: { status: action === 'start' ? 'RUNNING' : current.status, startedAt: action === 'start' ? current.startedAt || new Date() : current.startedAt, statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'GROUP_RUNTIME_BATCH_CHANGED', 'ALL', null, { action, groupCount: eligible.length, reason: body.reason || null })
  })
  return getTrainingWorkspace(userId, sessionId)
}
async function cloneStageGroupUnit(
  tx: Prisma.TransactionClient,
  source: any,
  targetGroupId: string,
  targetGroupName: string,
  orderIndex: number,
  runtime: boolean,
) {
  const created = await tx.trainingSessionStageGroup.create({ data: {
    stageId: source.stageId,
    groupId: targetGroupId,
    mode: source.mode,
    accessPolicy: source.accessPolicy,
    submissionMode: source.submissionMode,
    plannedDurationSeconds: source.plannedDurationSeconds,
    completionThreshold: source.completionThreshold,
    minDurationSeconds: source.minDurationSeconds,
    completionPolicy: asJson(source.completionPolicy),
    transitionPolicy: source.transitionPolicy,
    status: runtime ? source.status : 'PENDING',
    startedAt: runtime ? source.startedAt : null,
    runningSince: runtime ? source.runningSince : null,
    activeElapsedSeconds: runtime ? source.activeElapsedSeconds : 0,
    rules: asJson(source.rules),
  } })
  for (const plan of source.ProblemPlans || []) await tx.trainingSessionStageProblemPlan.create({ data: {
    stageId: source.stageId,
    stageProblemId: plan.stageProblemId,
    stageGroupId: created.id,
    orderIndex: plan.orderIndex,
    unlockPolicy: asJson(plan.unlockPolicy),
    targetScore: plan.targetScore,
    scoreGoals: asJson(plan.scoreGoals),
    timePolicy: asJson(plan.timePolicy),
    stuckPolicy: asJson(plan.stuckPolicy),
    hintPolicy: asJson(plan.hintPolicy),
    allowedSubtaskIds: asJson(plan.allowedSubtaskIds),
    judgeConfigProjection: plan.judgeConfigProjection,
    strategyIntervalSeconds: plan.strategyIntervalSeconds,
    rules: asJson(plan.rules),
  } })
  return created
}

export async function splitTrainingGroup(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  if (!['RUNNING', 'PAUSED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_GROUP_SPLIT_REQUIRES_RUNNING', '只有运行中的训练可以拆组')
  const expectedRevision = Number(body.expectedRevision)
  const name = boundedText(body.name, 100, '新分组名称', 1)
  const reason = boundedText(body.reason, 2000, '拆组原因', 1)
  const participantIds = [...new Set<string>((Array.isArray(body.participantIds) ? body.participantIds : []).map((value: unknown) => String(value)))]
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    const source = await tx.trainingSessionGroup.findFirst({
      where: { id: String(body.sourceGroupId), sessionId, status: 'active' },
      include: { Participants: { where: { status: 'active' } }, StageGroups: { include: { ProblemPlans: true, Stage: true } } },
    })
    if (!source) throw new TrainingEngineError(404, 'TRAINING_GROUP_NOT_FOUND', '来源分组不存在')
    const selected = source.Participants.filter(item => participantIds.includes(item.id))
    if (!selected.length || selected.length !== participantIds.length) throw new TrainingEngineError(422, 'TRAINING_GROUP_SPLIT_PARTICIPANTS_INVALID', '拆组学员必须全部来自来源分组')
    if (selected.length >= source.Participants.length) throw new TrainingEngineError(422, 'TRAINING_GROUP_SPLIT_SOURCE_EMPTY', '拆组后来源分组必须至少保留一名学员')
    const maximum = await tx.trainingSessionGroup.aggregate({ where: { sessionId }, _max: { orderIndex: true } })
    const target = await tx.trainingSessionGroup.create({ data: { sessionId, name, orderIndex: (maximum._max.orderIndex ?? -1) + 1 } })
    const active = source.StageGroups.find(item => ['RUNNING', 'PAUSED'].includes(item.status))
    const future = source.StageGroups.filter(item => item.status === 'PENDING')
    for (const unit of source.StageGroups.filter(item => item === active || future.includes(item)).sort((a, b) => a.Stage.orderIndex - b.Stage.orderIndex)) {
      await cloneStageGroupUnit(tx, unit, target.id, target.name, target.orderIndex, unit === active)
    }
    await tx.trainingSessionParticipant.updateMany({ where: { id: { in: participantIds } }, data: { groupId: target.id, currentProblemId: null } })
    for (const participant of selected) {
      await tx.trainingSessionGroupChange.create({ data: { sessionId, participantId: participant.id, fromGroupId: source.id, toGroupId: target.id, reason, changedBy: userId } })
      if (active) await tx.trainingSessionStageParticipantAssignment.upsert({
        where: { stageId_participantId: { stageId: active.stageId, participantId: participant.id } },
        update: { groupId: target.id, assignedAt: new Date(), assignedBy: userId, source: 'split-group-v2' },
        create: { stageId: active.stageId, participantId: participant.id, groupId: target.id, assignedBy: userId, source: 'split-group-v2' },
      })
    }
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'GROUP_SPLIT', 'GROUP', target.id, { sourceGroupId: source.id, participantCount: selected.length, reason })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function mergeTrainingGroup(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  if (!['RUNNING', 'PAUSED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_GROUP_MERGE_REQUIRES_RUNNING', '只有运行中的训练可以合组')
  const expectedRevision = Number(body.expectedRevision)
  const reason = boundedText(body.reason, 2000, '合组原因', 1)
  if (String(body.sourceGroupId) === String(body.targetGroupId)) throw new TrainingEngineError(422, 'TRAINING_GROUP_MERGE_SAME_GROUP', '来源分组与目标分组不能相同')
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    const [source, target] = await Promise.all([
      tx.trainingSessionGroup.findFirst({ where: { id: String(body.sourceGroupId), sessionId, status: 'active' }, include: { Participants: { where: { status: 'active' } }, StageGroups: true } }),
      tx.trainingSessionGroup.findFirst({ where: { id: String(body.targetGroupId), sessionId, status: 'active' }, include: { StageGroups: true } }),
    ])
    if (!source || !target) throw new TrainingEngineError(404, 'TRAINING_GROUP_NOT_FOUND', '来源或目标分组不存在')
    const sourceActive = source.StageGroups.find(item => ['RUNNING', 'PAUSED'].includes(item.status))
    const targetActive = target.StageGroups.find(item => ['RUNNING', 'PAUSED'].includes(item.status))
    if (!sourceActive || !targetActive || sourceActive.stageId !== targetActive.stageId) throw new TrainingEngineError(409, 'TRAINING_GROUP_MERGE_STAGE_MISMATCH', '运行中合组要求两个分组当前位于同一 Stage')
    const now = new Date()
    const elapsed = sourceActive.runningSince ? Math.max(0, Math.floor((now.getTime() - sourceActive.runningSince.getTime()) / 1000)) : 0
    await tx.trainingSessionStageGroup.update({ where: { id: sourceActive.id }, data: { status: 'ENDED', runningSince: null, activeElapsedSeconds: { increment: elapsed }, endedAt: now, endReason: 'MERGED' } })
    await tx.trainingSessionStageGroup.updateMany({ where: { groupId: source.id, status: 'PENDING' }, data: { status: 'SKIPPED', endedAt: now, endReason: 'MERGED' } })
    await tx.trainingSessionParticipant.updateMany({ where: { groupId: source.id, status: 'active' }, data: { groupId: target.id, currentProblemId: null } })
    for (const participant of source.Participants) {
      await tx.trainingSessionGroupChange.create({ data: { sessionId, participantId: participant.id, fromGroupId: source.id, toGroupId: target.id, reason, changedBy: userId } })
      await tx.trainingSessionStageParticipantAssignment.upsert({
        where: { stageId_participantId: { stageId: targetActive.stageId, participantId: participant.id } },
        update: { groupId: target.id, assignedAt: now, assignedBy: userId, source: 'merge-group-v2' },
        create: { stageId: targetActive.stageId, participantId: participant.id, groupId: target.id, assignedBy: userId, source: 'merge-group-v2' },
      })
    }
    await tx.trainingSessionGroup.update({ where: { id: source.id }, data: { status: 'archived' } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'GROUP_MERGED', 'GROUP', target.id, { sourceGroupId: source.id, participantCount: source.Participants.length, reason })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function archiveTrainingSession(userId: string, sessionId: string, expectedRevision: number) {
  const session = await assertManage(userId, sessionId)
  if (!['ENDED', 'DRAFT'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_ARCHIVE_REQUIRES_ENDED', '只能归档草稿或已结束训练')
  const changed = await prisma.trainingSession.updateMany({ where: { id: sessionId, statusRevision: expectedRevision, status: session.status }, data: { status: 'ARCHIVED', archivedAt: new Date(), statusRevision: { increment: 1 } } })
  if (!changed.count) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
  return loadSession(sessionId)
}

export async function executeTrainingCommand(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const type = String(body?.type || '').toUpperCase()
  if (!COMMANDS.has(type)) throw new TrainingEngineError(422, 'UNKNOWN_TRAINING_COMMAND', '不支持的教练命令')
  const expectedRevision = Number(body?.expectedRevision)
  if (expectedRevision !== session.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
  const targetType = String(body?.targetType || 'ALL').toUpperCase() as TrainingEngineTargetType
  if (!['ALL', 'GROUP', 'TEAM', 'USER'].includes(targetType)) throw new TrainingEngineError(422, 'INVALID_TRAINING_COMMAND_TARGET', '不支持的命令目标类型')
  if (SESSION_WIDE_COMMANDS.has(type) && targetType !== 'ALL') throw new TrainingEngineError(422, 'INVALID_TRAINING_COMMAND_TARGET', '训练生命周期、阶段切换和延时命令只能作用于全员')
  let targetId = body?.targetId ? String(body.targetId) : null
  const payload = parseJsonObject(body?.payload)

  if (type === 'MOVE_GROUP') {
    assertTrainingCommandAllowed(type, session.status)
    if (targetType !== 'USER' || !targetId) throw new TrainingEngineError(422, 'TRAINING_COMMAND_TARGET_REQUIRED', '换组命令必须指定学员')
    const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId: targetId } } })
    if (!participant || participant.status !== 'active') throw new TrainingEngineError(404, 'TRAINING_PARTICIPANT_NOT_FOUND', '学员不属于当前训练')
    const effectiveMode = String(payload.effectiveMode || 'IMMEDIATE').toUpperCase()
    const sourceStageId = String(payload.stageId || '')
    return changeTrainingStageGroup(userId, sessionId, sourceStageId, {
      expectedRevision,
      participantId: participant.id,
      toGroupId: payload.toGroupId,
      effectiveMode,
      targetStageId: payload.targetStageId,
      reason: payload.reason || 'Runtime MOVE_GROUP',
    })
  }

  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    assertTrainingCommandAllowed(type, current.status)
    targetId = await normalizeCommandTarget(tx, session, targetType, targetId)
    let nextStatus: TrainingEngineSessionStatus | undefined
    const update: Prisma.TrainingSessionUpdateInput = { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } }
    const handlers = createTrainingRuntimeCommandHandlers({
      tx,
      current,
      session,
      sessionId,
      userId,
      type,
      targetType,
      targetId,
      payload,
      update,
      setNextStatus: status => { nextStatus = status },
      activeStageIncrement,
      sameOverlayTarget,
      restoreFocusParticipants,
      targetApplies,
      boundedText,
      asJson,
      appendEvent,
    })
    const dispatcher = createTrainingCommandDispatcher(handlers)
    await dispatcher.dispatch(type)
    const updated = await tx.trainingSession.update({ where: { id: sessionId }, data: update })
    await tx.trainingSessionCommand.create({ data: { sessionId, seq: updated.commandSeq, type, targetType, targetId, payload: asJson(payload), createdBy: userId } })
    await appendEvent(tx, sessionId, `training.command.${type.toLowerCase()}`, targetType, targetId, { ...payload, status: nextStatus })
    if (type === 'PAUSE_SESSION') {
      await appendEvent(tx, sessionId, TrainingEventTypes.SESSION_PAUSED, 'ALL', null, { mode: payload.mode === 'HARD' ? 'HARD' : 'SOFT' })
    } else if (type === 'RESUME_SESSION') {
      await appendEvent(tx, sessionId, TrainingEventTypes.SESSION_RESUMED, 'ALL', null, {})
    } else if (type === 'UNLOCK_FOR_USER') {
      await appendEvent(tx, sessionId, TrainingEventTypes.PROBLEM_UNLOCKED, 'USER', targetId, { stageProblemId: payload.stageProblemId, source: 'teacher' })
    } else if (type === 'SKIP_FOR_USER') {
      await appendEvent(tx, sessionId, TrainingEventTypes.PROBLEM_SKIPPED, 'USER', targetId, { stageProblemId: payload.stageProblemId, source: 'teacher' })
    } else if (type === 'OPEN_HINT') {
      await appendEvent(tx, sessionId, TrainingEventTypes.HINT_OPENED, targetType, targetId, { hintId: payload.hintId })
    } else if (type === 'SHOW_MESSAGE') {
      await appendEvent(tx, sessionId, TrainingEventTypes.MESSAGE_SHOWN, targetType, targetId, { message: payload.message, messageType: payload.messageType })
    }
  })
  return loadSession(sessionId)
}

export async function saveTrainingDraft(userId: string, sessionId: string, stageProblemId: string, body: any) {
  const session = await assertAccess(userId, sessionId)
  const stageProblem = session.Stages.flatMap(stage => stage.Problems).find(item => item.id === stageProblemId)
  if (!stageProblem) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  if (!await canManageSession(userId, session)) {
    const permission = await resolveTrainingPermission(userId, sessionId, stageProblemId)
    if (!permission.canEdit) throw new TrainingEngineError(403, permission.reason, '当前训练规则不允许编辑代码草稿')
  }
  const code = String(body?.code ?? '')
  if (Buffer.byteLength(code, 'utf8') > 1024 * 1024) throw new TrainingEngineError(413, 'TRAINING_DRAFT_TOO_LARGE', '代码草稿不能超过 1 MiB')
  const key = { sessionId_userId_stageProblemId: { sessionId, userId, stageProblemId } }
  const existing = await prisma.trainingSessionProblemDraft.findUnique({ where: key })
  if (existing && body?.expectedRevision !== undefined && Number(body.expectedRevision) !== existing.revision) throw new TrainingEngineError(409, 'TRAINING_DRAFT_STALE', '草稿已在另一页面更新')
  return prisma.trainingSessionProblemDraft.upsert({
    where: key,
    update: { language: String(body?.language || existing?.language || 'cpp17'), code, inputFilename: body?.inputFilename || null, outputFilename: body?.outputFilename || null, editorFocused: Boolean(body?.editorFocused), revision: { increment: 1 } },
    create: { sessionId, userId, stageProblemId, language: String(body?.language || 'cpp17'), code, inputFilename: body?.inputFilename || null, outputFilename: body?.outputFilename || null, editorFocused: Boolean(body?.editorFocused) },
  })
}

export async function getTrainingDraft(userId: string, sessionId: string, stageProblemId: string) {
  const session = await assertAccess(userId, sessionId)
  if (!session.Stages.some(stage => stage.Problems.some(problem => problem.id === stageProblemId))) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  return prisma.trainingSessionProblemDraft.findUnique({ where: { sessionId_userId_stageProblemId: { sessionId, userId, stageProblemId } } })
}

export async function recordHeartbeat(userId: string, sessionId: string, body: any) {
  const session = await assertAccess(userId, sessionId)
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  if (!participant) throw new TrainingEngineError(403, 'TRAINING_PARTICIPANT_REQUIRED', '需要先加入训练')
  const stageProblemId = body?.stageProblemId ? String(body.stageProblemId) : null
  if (!stageProblemId) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_REQUIRED', '请选择当前题目')
  const permission = await resolveTrainingPermission(userId, sessionId, stageProblemId)
  if (!permission.canView) throw new TrainingEngineError(403, permission.reason, '当前题目尚未开放')
  const stage = session.Stages.find(item => item.Problems.some(problem => problem.id === stageProblemId))
  const stageProblem = stage?.Problems.find(problem => problem.id === stageProblemId)
  const assignment = stage?.ParticipantAssignments.find(item => item.participantId === participant.id)
  const group = assignment?.groupId ? stage?.Groups.find(item => item.groupId === assignment.groupId) : null
  const plan = stageProblem?.Plans.find(item => item.stageGroupId === group?.id)
  if (!stage || !stageProblem) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  const effectiveRule = resolveEffectiveTrainingRule({ stage, group: group as any, plan })
  const { minActiveSeconds, minAttempts, noImprovementSeconds } = effectiveRule.stuckPolicy
  const now = new Date(), previous = participant.lastHeartbeatAt?.getTime() || now.getTime()
  const elapsed = session.status === 'RUNNING' && body?.pageVisible && body?.editorFocused ? Math.min(30, Math.max(0, Math.floor((now.getTime() - previous) / 1000))) : 0
  return prisma.$transaction(async tx => {
    const updatedParticipant = await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { lastHeartbeatAt: now, activeSeconds: { increment: elapsed }, currentProblemId: stageProblemId } })
    const existing = await tx.trainingSessionProblemProgress.findUnique({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } } })
    const preservedStatus = existing && ['COMPLETED', 'SKIPPED', 'STUCK'].includes(existing.status) ? existing.status : 'WORKING'
    const switchedProblem = Boolean(participant.currentProblemId && participant.currentProblemId !== stageProblemId)
    const current = await tx.trainingSessionProblemProgress.upsert({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } }, update: { lastOpenedAt: now, activeSeconds: { increment: elapsed }, continuousActiveSeconds: switchedProblem ? elapsed : { increment: elapsed }, lastProgressAt: now, status: preservedStatus }, create: { participantId: participant.id, stageProblemId, status: 'WORKING', firstOpenedAt: now, lastOpenedAt: now, activeSeconds: elapsed, continuousActiveSeconds: elapsed, lastProgressAt: now } })
    const terminal = ['COMPLETED', 'SKIPPED'].includes(current.status)
    const stuck = !terminal && current.activeSeconds >= minActiveSeconds && current.attemptCount >= minAttempts && (!current.lastScoreImprovedAt || now.getTime() - current.lastScoreImprovedAt.getTime() >= noImprovementSeconds * 1000)
    if (switchedProblem && participant.currentProblemId) {
      const previousProgress = await tx.trainingSessionProblemProgress.findUnique({
        where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: participant.currentProblemId } },
      })
      if (previousProgress?.status === 'STUCK') {
        await tx.trainingSessionProblemProgress.update({ where: { id: previousProgress.id }, data: { status: 'WORKING', stuckDetectedAt: null, continuousActiveSeconds: 0 } })
        await appendEvent(tx, sessionId, TrainingEventTypes.PROBLEM_STUCK_CLEARED, 'USER', userId, {
          participantId: participant.id,
          stageProblemId: participant.currentProblemId,
          reason: 'problem_switch',
          at: now.toISOString(),
        })
      }
    }
    if (stuck && current.status !== 'STUCK') {
      await tx.trainingSessionProblemProgress.update({ where: { id: current.id }, data: { status: 'STUCK', stuckDetectedAt: now } })
      await appendEvent(tx, sessionId, TrainingEventTypes.PROBLEM_STUCK, 'USER', userId, {
        participantId: participant.id,
        stageProblemId,
        at: now.toISOString(),
      })
    }
    return { participant: updatedParticipant, progress: { ...current, status: stuck ? 'STUCK' : current.status } }
  })
}

export async function submitTrainingSolution(userId: string, sessionId: string, body: any) {
  const session = await assertAccess(userId, sessionId)
  const stageProblemId = String(body?.stageProblemId || '')
  const permission = await resolveTrainingPermission(userId, sessionId, stageProblemId)
  if (!permission.canSubmit) throw new TrainingEngineError(403, permission.reason, '当前训练规则不允许提交该题')
  const stageProblem = session.Stages.flatMap(stage => stage.Problems).find(item => item.id === stageProblemId)
  if (!stageProblem) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  const language = boundedText(body?.language, 30, '语言', 1), code = String(body?.code || '')
  if (!code.trim() || Buffer.byteLength(code, 'utf8') > 1024 * 1024) throw new TrainingEngineError(422, 'INVALID_SUBMISSION_CODE', '代码不能为空且不能超过 1 MiB')
  const revision = await prisma.problemTestSetRevision.findUniqueOrThrow({ where: { id: stageProblem.testSetRevisionId } })
  const participant = await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { sessionId_userId: { sessionId, userId } } })
  const assignment = session.Stages.find(stage => stage.id === stageProblem.stageId)?.ParticipantAssignments.find(item => item.participantId === participant.id)
  const plan = stageProblem.Plans.find(item => item.stageGroupId === session.Stages.find(stage => stage.id === stageProblem.stageId)?.Groups.find(unit => unit.groupId === participant.groupId)?.id)
  const goals = Array.isArray(plan?.scoreGoals) ? plan.scoreGoals as Array<{ score: number; allowedSubtaskIds?: number[] }> : Array.isArray(stageProblem.scoreGoals) ? stageProblem.scoreGoals as Array<{ score: number; allowedSubtaskIds?: number[] }> : []
  const progress = await prisma.trainingSessionProblemProgress.findUnique({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } } })
  const nextGoalIndex = goals.findIndex(goal => goal.score > (progress?.bestScore || 0))
  const goalIndex = goals.length ? (nextGoalIndex < 0 ? goals.length - 1 : nextGoalIndex) : null
  const goal = goalIndex === null ? null : goals[goalIndex]
  const goalSubtasks = goal?.allowedSubtaskIds?.length ? goal.allowedSubtaskIds : []
  const planSubtasks = Array.isArray(plan?.allowedSubtaskIds) ? plan.allowedSubtaskIds.map(Number) : []
  const selectedSubtasks = goalSubtasks.length ? goalSubtasks : planSubtasks
  const baseConfig = yaml.load(revision.judgeConfig) as any
  const configText = selectedSubtasks.length
    ? yaml.dump({ ...baseConfig, subtasks: (baseConfig?.subtasks || []).filter((subtask: any) => selectedSubtasks.includes(Number(subtask.id))) }, { noRefs: true, lineWidth: 120 })
    : plan?.judgeConfigProjection || stageProblem.judgeConfigProjection || revision.judgeConfig
  const judgeConfigHash = crypto.createHash('sha256').update(configText).digest('hex')
  const goalSnapshot = goal ? { ...goal, allowedSubtaskIds: selectedSubtasks, judgeConfigHash } : null
  const config = yaml.load(configText) as any
  const io = normalizeSubmissionIo({ inputFilename: body?.inputFilename, outputFilename: body?.outputFilename, problemType: config?.type })
  return createQueuedSubmissionWithRun({ userId, workspaceScope: session.organizationId ? 'campus' : 'personal', organizationId: session.organizationId, oj: stageProblem.Problem.platform, problemId: stageProblem.Problem.problemId, language, code, codeLength: Buffer.byteLength(code, 'utf8'), submitMethod: 'local', problemInternalId: stageProblem.problemId, submitScope: 'training_engine', trainingSessionId: sessionId, trainingStageProblemId: stageProblemId, trainingScoreGoalIndex: goalIndex, trainingScoreGoalSnapshot: asJson(goalSnapshot), testSetRevisionId: revision.id, judgeConfigHash, judgeConfigSnapshot: configText, ...io, isGlobalVisible: true }, { requestedBy: userId })
}

export async function createTrainingHint(userId: string, sessionId: string, body: any) {
  await assertManage(userId, sessionId)
  const stageProblemId = String(body?.stageProblemId || '')
  const belongs = await prisma.trainingSessionStageProblem.findFirst({ where: { id: stageProblemId, Stage: { sessionId } }, include: { Stage: { select: { Groups: { select: { status: true } } } } } })
  if (!belongs) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  if (belongs.Stage.Groups.some(unit => unit.status !== 'PENDING')) throw new TrainingEngineError(409, 'TRAINING_HINT_DEFINITION_FROZEN', '阶段开始后提示定义不可新增或修改，请使用运行时开放已有提示')
  const level = boundedInteger(body?.level, 1, 20, '提示级别', false)!
  const openMode = enumValue(body?.openMode, HINT_OPEN_MODES, 'MANUAL', '提示开放方式')
  const triggerSeconds = boundedInteger(body?.triggerSeconds, 60, 86400, '触发时间')
  const triggerAttempts = boundedInteger(body?.triggerAttempts, 1, 100, '触发提交数')
  const triggerScore = boundedInteger(body?.triggerScore, 0, 100, '触发分数')
  if ((openMode === 'TIME' && triggerSeconds === null) || (openMode === 'ATTEMPT' && triggerAttempts === null) || (openMode === 'SCORE' && triggerScore === null)) throw new TrainingEngineError(422, 'TRAINING_HINT_TRIGGER_REQUIRED', '自动开放提示必须设置对应触发条件')
  if (await prisma.trainingSessionHint.findUnique({ where: { stageProblemId_level: { stageProblemId, level } }, select: { id: true } })) throw new TrainingEngineError(409, 'TRAINING_HINT_LEVEL_EXISTS', '当前题目已存在相同级别的提示')
  return prisma.trainingSessionHint.create({ data: { sessionId, stageProblemId, level, title: body?.title ? boundedText(body.title, 100, '提示标题') : null, content: boundedText(body?.content, 5000, '提示内容', 1), openMode: openMode as any, triggerSeconds, triggerAttempts, triggerScore, createdBy: userId } })
}

export async function updateTrainingHint(userId: string, sessionId: string, hintId: string, body: any) {
  await assertManage(userId, sessionId)
  const hint = await prisma.trainingSessionHint.findFirst({ where: { id: hintId, sessionId }, include: { StageProblem: { include: { Stage: { select: { Groups: { select: { status: true } } } } } } } })
  if (!hint) throw new TrainingEngineError(404, 'TRAINING_HINT_NOT_FOUND', '提示不存在')
  if (hint.StageProblem.Stage.Groups.some(unit => unit.status !== 'PENDING')) throw new TrainingEngineError(409, 'TRAINING_HINT_DEFINITION_FROZEN', '阶段开始后提示定义不可修改')
  const level = boundedInteger(body?.level, 1, 20, '提示级别', false)!
  const openMode = enumValue(body?.openMode, HINT_OPEN_MODES, 'MANUAL', '提示开放方式')
  const triggerSeconds = boundedInteger(body?.triggerSeconds, 60, 86400, '触发时间')
  const triggerAttempts = boundedInteger(body?.triggerAttempts, 1, 100, '触发提交数')
  const triggerScore = boundedInteger(body?.triggerScore, 0, 100, '触发分数')
  if ((openMode === 'TIME' && triggerSeconds === null) || (openMode === 'ATTEMPT' && triggerAttempts === null) || (openMode === 'SCORE' && triggerScore === null)) throw new TrainingEngineError(422, 'TRAINING_HINT_TRIGGER_REQUIRED', '自动开放提示必须设置对应触发条件')
  const duplicate = await prisma.trainingSessionHint.findFirst({ where: { stageProblemId: hint.stageProblemId, level, id: { not: hintId } }, select: { id: true } })
  if (duplicate) throw new TrainingEngineError(409, 'TRAINING_HINT_LEVEL_EXISTS', '当前题目已存在相同级别的提示')
  return prisma.trainingSessionHint.update({ where: { id: hintId }, data: { level, title: body?.title ? boundedText(body.title, 100, '提示标题') : null, content: boundedText(body?.content, 5000, '提示内容', 1), openMode: openMode as any, triggerSeconds, triggerAttempts, triggerScore } })
}

export async function deleteTrainingHint(userId: string, sessionId: string, hintId: string) {
  await assertManage(userId, sessionId)
  const hint = await prisma.trainingSessionHint.findFirst({ where: { id: hintId, sessionId }, include: { StageProblem: { include: { Stage: { select: { Groups: { select: { status: true } } } } } } } })
  if (!hint) throw new TrainingEngineError(404, 'TRAINING_HINT_NOT_FOUND', '提示不存在')
  if (hint.StageProblem.Stage.Groups.some(unit => unit.status !== 'PENDING')) throw new TrainingEngineError(409, 'TRAINING_HINT_DEFINITION_FROZEN', '阶段开始后提示定义不可删除')
  await prisma.trainingSessionHint.delete({ where: { id: hintId } })
  return { deleted: true as const }
}

export async function listAvailableHints(userId: string, sessionId: string, stageProblemId: string) {
  const session = await assertAccess(userId, sessionId)
  const manager = await canManageSession(userId, session)
  const permission = await resolveTrainingPermission(userId, sessionId, stageProblemId)
  if (!permission.canOpenHint) return []
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  const progress = participant ? await prisma.trainingSessionProblemProgress.findUnique({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } } }) : null
  const hints = await prisma.trainingSessionHint.findMany({ where: { sessionId, stageProblemId }, orderBy: { level: 'asc' } })
  if (manager) return hints.map(hint => ({ id: hint.id, level: hint.level, title: hint.title, content: hint.content, openMode: hint.openMode, globallyOpenedAt: hint.globallyOpenedAt, opened: Boolean(hint.globallyOpenedAt) }))
  const accesses = participant ? await prisma.trainingSessionHintAccess.findMany({ where: { participantId: participant.id, hintId: { in: hints.map(hint => hint.id) } }, select: { hintId: true } }) : []
  const accessed = new Set(accesses.map(item => item.hintId))
  const targeted = new Set(session.Overlays.filter(overlay => overlay.type === 'HINT_OPEN' && participant && targetApplies(overlay.targetType, overlay.targetId, participant, session)).map(overlay => String(parseJsonObject(overlay.payload).hintId || '')))
  return hints.filter(hint => accessed.has(hint.id) || targeted.has(hint.id) || hint.globallyOpenedAt || hint.openMode === 'TIME' && Number(progress?.activeSeconds || 0) >= Number(hint.triggerSeconds || Infinity) || hint.openMode === 'ATTEMPT' && Number(progress?.attemptCount || 0) >= Number(hint.triggerAttempts || Infinity) || hint.openMode === 'SCORE' && Number(progress?.bestScore || 0) >= Number(hint.triggerScore || Infinity)).map(hint => ({ id: hint.id, level: hint.level, title: hint.title, opened: accessed.has(hint.id) }))
}

export async function openTrainingHint(userId: string, sessionId: string, hintId: string) {
  const hint = await prisma.trainingSessionHint.findFirst({ where: { id: hintId, sessionId } })
  if (!hint) throw new TrainingEngineError(404, 'TRAINING_HINT_NOT_FOUND', '提示不存在')
  const available = await listAvailableHints(userId, sessionId, hint.stageProblemId)
  if (!available.some(item => item.id === hintId)) throw new TrainingEngineError(403, 'TRAINING_HINT_LOCKED', '提示尚未开放')
  const participant = await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { sessionId_userId: { sessionId, userId } } })
  await prisma.$transaction(async tx => {
    const previousAccess = await tx.trainingSessionHintAccess.findUnique({ where: { hintId_participantId: { hintId, participantId: participant.id } } })
    if (previousAccess) return
    await tx.trainingSessionHintAccess.create({ data: { hintId, participantId: participant.id, source: hint.globallyOpenedAt ? 'teacher' : hint.openMode.toLowerCase() } })
    await tx.trainingSessionProblemProgress.upsert({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: hint.stageProblemId } }, update: { hintCount: { increment: 1 }, highestHintLevel: { set: Math.max(hint.level, (await tx.trainingSessionProblemProgress.findUnique({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: hint.stageProblemId } }, select: { highestHintLevel: true } }))?.highestHintLevel || 0) } }, create: { participantId: participant.id, stageProblemId: hint.stageProblemId, hintCount: 1, highestHintLevel: hint.level } })
  })
  return { ...hint, content: hint.content }
}

export async function processDueTrainingSessions(now = new Date()) {
  const expired = await prisma.trainingSessionOverlay.findMany({ where: { status: 'active', expiresAt: { lte: now } }, select: { id: true, sessionId: true }, take: 500 })
  if (expired.length) await prisma.trainingSessionOverlay.updateMany({ where: { id: { in: expired.map(item => item.id) } }, data: { status: 'expired', endedAt: now } })
  const scheduled = await prisma.trainingSession.findMany({ where: { status: 'SCHEDULED', scheduledStartAt: { lte: now } }, select: { id: true }, take: 50 })
  let started = 0, advanced = 0, ended = 0
  for (const item of scheduled) try {
    await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + item.id)
      const current = await tx.trainingSession.findUnique({ where: { id: item.id }, include: { Groups: { where: { status: 'active' } } } })
      if (!current || current.status !== 'SCHEDULED') return
      for (const group of current.Groups) await applyGroupRuntimeAction(tx, current.id, group.id, 'start', 'system', '计划时间到达')
      await tx.trainingSession.update({ where: { id: current.id }, data: { status: 'RUNNING', startedAt: current.startedAt || now, runningSince: now, statusRevision: { increment: 1 } } })
      started++
    })
  } catch { /* another scheduler won */ }
  const running = await prisma.trainingSession.findMany({ where: { status: 'RUNNING' }, select: { id: true, settings: true }, take: 100 })
  for (const session of running) {
    const dueAtValue = parseJsonObject(session.settings).dueAt
    const dueAt = typeof dueAtValue === 'string' ? new Date(dueAtValue) : null
    if (dueAt && Number.isFinite(dueAt.getTime()) && dueAt <= now) try {
      await prisma.$transaction(async tx => {
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + session.id)
        const units = await tx.trainingSessionStageGroup.findMany({ where: { Stage: { sessionId: session.id }, status: { in: ['RUNNING', 'PAUSED'] } } })
        for (const unit of units) {
          const elapsed = unit.status === 'RUNNING' && unit.runningSince ? Math.max(0, Math.floor((now.getTime() - unit.runningSince.getTime()) / 1000)) : 0
          await tx.trainingSessionStageGroup.update({ where: { id: unit.id }, data: { status: 'ENDED', runningSince: null, activeElapsedSeconds: { increment: elapsed }, endedAt: now, endReason: 'TIME_REACHED' } })
        }
        await tx.trainingSession.update({ where: { id: session.id }, data: { status: 'ENDED', endedAt: now, runningSince: null, statusRevision: { increment: 1 } } })
        ended++
      })
    } catch { /* another command won */ }
  }
  return { started, advanced, ended }
}

export async function recordStrategyDecision(userId: string, sessionId: string, body: any) {
  const session = await assertAccess(userId, sessionId)
  if (session.status !== 'RUNNING') throw new TrainingEngineError(409, 'TRAINING_SESSION_NOT_RUNNING', '只有进行中的训练可以记录策略决策')
  const participant = await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { sessionId_userId: { sessionId, userId } } })
  const stageProblemId = body?.stageProblemId ? String(body.stageProblemId) : null
  if (stageProblemId && !await prisma.trainingSessionStageProblem.findFirst({ where: { id: stageProblemId, Stage: { sessionId } }, select: { id: true } })) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  const progress = stageProblemId ? await prisma.trainingSessionProblemProgress.findUnique({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } } }) : null
  const decision = String(body?.decision || '').toUpperCase()
  if (!['CONTINUE', 'SWITCH'].includes(decision)) throw new TrainingEngineError(422, 'INVALID_STRATEGY_DECISION', '策略选择只允许继续当前题或切题')
  return prisma.trainingSessionStrategyDecision.create({ data: { sessionId, participantId: participant.id, stageProblemId, decision, reason: body?.reason ? boundedText(body.reason, 1000, '策略说明') : null, activeSecondsAtDecision: progress?.activeSeconds || 0 } })
}

export async function getCoachDashboard(userId: string, sessionId: string) {
  const session = await assertManage(userId, sessionId)
  const participants = await prisma.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, include: { User: { select: { id: true, username: true, avatar: true } }, Group: { include: { StageGroups: { include: { Stage: true, ProblemPlans: true } } } }, Progress: true } })
  const now = Date.now()
  const rows = participants.map(item => {
    const activeUnit = item.Group.StageGroups.find(unit => ['RUNNING', 'PAUSED'].includes(unit.status))
    const requirements = activeUnit?.ProblemPlans.map(plan => {
      const progress = item.Progress.find(entry => entry.stageProblemId === plan.stageProblemId)
      return { stageProblemId: plan.stageProblemId, state: progress?.status === 'COMPLETED' ? 'SATISFIED' : progress?.status === 'SKIPPED' ? 'BYPASSED' : 'REQUIRED' }
    }) || []
    const completedCount = requirements.filter(requirement => ['SATISFIED', 'BYPASSED'].includes(requirement.state)).length
    return { id: item.id, user: item.User, currentGroupId: item.groupId, activeStageId: activeUnit?.stageId || null, currentProblemId: item.currentProblemId, activeSeconds: item.activeSeconds, online: Boolean(item.lastHeartbeatAt && now - item.lastHeartbeatAt.getTime() < 90000), requiredCount: requirements.length, completedCount, completed: requirements.length > 0 && completedCount === requirements.length, working: item.Progress.some(progress => progress.status === 'WORKING'), stuck: item.Progress.some(progress => progress.status === 'STUCK'), requirements, progress: item.Progress }
  })
  const activeUnits = session.Groups.flatMap(group => group.StageGroups.filter(unit => ['RUNNING', 'PAUSED'].includes(unit.status)).map(unit => ({ groupId: group.id, groupName: group.name, stageId: unit.stageId, status: unit.status })))
  return { session: { id: session.id, title: session.title, status: session.status, activeUnits }, participants: rows, summary: { total: rows.length, working: rows.filter(item => item.working).length, stuck: rows.filter(item => item.stuck).length, completed: rows.filter(item => item.completed).length } }
}

export async function getTrainingPeerProgress(userId: string, sessionId: string) {
  const session = await assertAccess(userId, sessionId)
  const manager = await canManageSession(userId, session)
  if (!manager && session.peerVisibility === 'NONE') return { rankingMode: session.rankingMode, peerVisibility: session.peerVisibility, entries: [] }
  const participants = await prisma.trainingSessionParticipant.findMany({
    where: { sessionId, status: 'active' },
    include: {
      User: { select: { id: true, username: true, avatar: true } },
      Progress: { include: { StageProblem: { select: { alias: true, Problem: { select: { problemId: true, title: true } } } } } },
    },
  })
  const submissions = session.rankingMode === 'ACM_RANKING' ? await prisma.submission.findMany({
    where: { trainingSessionId: sessionId, userId: { in: participants.map(item => item.userId) } },
    orderBy: { createdAt: 'asc' },
    select: { userId: true, trainingStageProblemId: true, createdAt: true, CurrentJudgeRun: { select: { result: true } } },
  }) : []
  const visibility = manager ? 'FULL' : session.peerVisibility
  const effectiveRanking = visibility === 'PROGRESS'
    ? (session.rankingMode === 'OFF' ? 'OFF' : 'PROGRESS_ONLY')
    : visibility === 'SCORE' && session.rankingMode === 'ACM_RANKING' ? 'SCORE' : session.rankingMode
  const rows = participants.map(participant => {
    const requirements = resolveParticipantSessionRequirements(session, participant.id, participant.Progress)
    const activeRequirements = requirements.filter(requirement => requirement.state !== 'RETIRED')
    const requiredIds = new Set(activeRequirements.map(requirement => requirement.stageProblemId))
    const completed = activeRequirements.filter(requirement => ['SATISFIED', 'BYPASSED'].includes(requirement.state)).length
    const score = participant.Progress.reduce((sum, progress) => sum + (progress.bestScore || 0), 0)
    const attempts = participant.Progress.reduce((sum, progress) => sum + progress.attemptCount, 0)
    const userSubmissions = submissions.filter(item => item.userId === participant.userId && item.trainingStageProblemId && requiredIds.has(item.trainingStageProblemId))
    let solved = 0, penaltyMinutes = 0
    for (const stageProblemId of requiredIds) {
      const attemptsForProblem = userSubmissions.filter(item => item.trainingStageProblemId === stageProblemId)
      const acceptedIndex = attemptsForProblem.findIndex(item => String(item.CurrentJudgeRun?.result || '').toLowerCase() === 'accepted')
      if (acceptedIndex < 0) continue
      solved++
      const acceptedAt = attemptsForProblem[acceptedIndex].createdAt.getTime()
      const elapsedMinutes = Math.max(0, Math.floor((acceptedAt - (session.startedAt?.getTime() || acceptedAt)) / 60_000))
      penaltyMinutes += elapsedMinutes + acceptedIndex * 20
    }
    const rankedCompleted = effectiveRanking === 'ACM_RANKING' ? solved : completed
    const base: Record<string, unknown> = { user: participant.User, completed: rankedCompleted, total: requiredIds.size }
    if (['SCORE', 'FULL'].includes(visibility)) base.score = score
    if (visibility === 'FULL') {
      base.attempts = attempts
      if (effectiveRanking === 'ACM_RANKING') base.penaltyMinutes = penaltyMinutes
      base.activeSeconds = participant.activeSeconds
      base.currentProblem = participant.Progress.find(progress => progress.stageProblemId === participant.currentProblemId)?.StageProblem || null
      base.progress = participant.Progress.map(progress => ({ stageProblemId: progress.stageProblemId, status: progress.status, bestScore: progress.bestScore, attemptCount: progress.attemptCount, activeSeconds: progress.activeSeconds, hintCount: progress.hintCount }))
    }
    return { base, completed: rankedCompleted, score, attempts, penaltyMinutes, username: participant.User.username }
  })
  if (effectiveRanking !== 'OFF') rows.sort((left, right) => effectiveRanking === 'PROGRESS_ONLY'
    ? right.completed - left.completed || left.username.localeCompare(right.username)
    : effectiveRanking === 'SCORE'
      ? right.score - left.score || right.completed - left.completed || left.username.localeCompare(right.username)
      : right.completed - left.completed || left.penaltyMinutes - right.penaltyMinutes || left.username.localeCompare(right.username))
  else rows.sort((left, right) => left.username.localeCompare(right.username))
  return { rankingMode: effectiveRanking, peerVisibility: visibility, entries: rows.map((row, index) => ({ ...(effectiveRanking === 'OFF' ? {} : { rank: index + 1 }), ...row.base })) }
}

export async function getTrainingReport(userId: string, sessionId: string) {
  const session = await assertAccess(userId, sessionId)
  const manager = await canManageSession(userId, session)
  const participants = await prisma.trainingSessionParticipant.findMany({
    where: manager ? { sessionId } : { sessionId, userId },
    include: { User: { select: { id: true, username: true } }, Group: true, Progress: { include: { StageProblem: { include: { Problem: { select: { title: true, problemId: true } } } } } }, ScoreEvents: { orderBy: { createdAt: 'asc' } } },
  })
  const now = new Date()
  const timeline = session.Stages.map(stage => ({
    id: stage.id, name: stage.name, orderIndex: stage.orderIndex, kind: stage.kind,
    groups: stage.Groups.map(unit => ({
      id: unit.id, groupId: unit.groupId, groupName: unit.TrainingGroup.name, status: unit.status,
      plannedDurationSeconds: unit.plannedDurationSeconds,
      actualDurationSeconds: unit.activeElapsedSeconds + (unit.status === 'RUNNING' && unit.runningSince ? Math.max(0, Math.floor((now.getTime() - unit.runningSince.getTime()) / 1000)) : 0),
      startedAt: unit.startedAt, endedAt: unit.endedAt, endReason: unit.endReason,
      problemIds: unit.ProblemPlans.map(plan => plan.stageProblemId),
    })),
    timeAdjustments: stage.TimeAdjustments,
  }))
  const groupChanges = await prisma.trainingSessionGroupChange.findMany({ where: { sessionId, ...(manager ? {} : { participantId: { in: participants.map(item => item.id) } }) }, orderBy: { createdAt: 'asc' } })
  return {
    session: { id: session.id, title: session.title, status: session.status, startedAt: session.startedAt, endedAt: session.endedAt },
    timeline,
    participants: participants.map(participant => ({ id: participant.id, user: participant.User, group: participant.Group, activeSeconds: participant.activeSeconds, progress: participant.Progress, scoreEvents: participant.ScoreEvents })),
    groupChanges,
  }
}

export async function listTrainingEvents(userId: string, sessionId: string, afterSeq: number) {
  const session = await assertAccess(userId, sessionId)
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  const events = await prisma.trainingSessionEvent.findMany({ where: { sessionId, seq: { gt: Math.max(0, afterSeq) } }, orderBy: { seq: 'asc' }, take: 200 })
  return events.filter(event => !participant || targetApplies(event.targetType, event.targetId, participant, session))
}

export async function syncTrainingEngineSubmission(submission: { id: number; userId: string; trainingSessionId: string | null; trainingStageProblemId: string | null; result: string | null; score: number | null; trainingScoreGoalSnapshot?: unknown }) {
  if (!submission.trainingSessionId || !submission.trainingStageProblemId) return
  const [participant, stageProblem] = await Promise.all([
    prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId: submission.trainingSessionId, userId: submission.userId } } }),
    prisma.trainingSessionStageProblem.findUnique({ where: { id: submission.trainingStageProblemId }, include: {
      Stage: { select: { sessionId: true, kind: true } },
      Plans: { include: { StageGroup: { select: { id: true, groupId: true, accessPolicy: true, submissionMode: true, rules: true } } } },
    } }),
  ])
  if (!participant || !stageProblem || stageProblem.Stage.sessionId !== submission.trainingSessionId) return
  const accepted = ['accepted', 'ac'].includes(String(submission.result || '').toLowerCase())
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-participant:${participant.id}`}, 0)) IS NULL AS locked`
    if (await tx.trainingSessionScoreEvent.findUnique({ where: { submissionId: submission.id }, select: { id: true } })) return
    const existing = await tx.trainingSessionProblemProgress.findUnique({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: submission.trainingStageProblemId! } } })
    const score = submission.score ?? (accepted ? 100 : 0)
    const bestScore = Math.max(existing?.bestScore || 0, score)
    const improved = bestScore > (existing?.bestScore ?? -1)
    const plan = stageProblem.Plans.find(item => item.StageGroup.groupId === participant.groupId)
    const effectiveRule = resolveEffectiveTrainingRule({ stage: stageProblem.Stage, group: plan?.StageGroup || null, plan })
    const completionScore = effectiveRule.scorePolicy.completionScore
    const completed = accepted || bestScore >= completionScore
    const nextStatus = completed ? 'COMPLETED' : existing?.status === 'STUCK' && !improved ? 'STUCK' : 'WORKING'
    await tx.trainingSessionProblemProgress.upsert({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: submission.trainingStageProblemId! } }, update: { attemptCount: { increment: 1 }, bestScore, bestVerdict: accepted || improved ? submission.result : existing?.bestVerdict, acAt: accepted ? existing?.acAt || new Date() : existing?.acAt, lastSubmissionAt: new Date(), lastScoreImprovedAt: improved ? new Date() : existing?.lastScoreImprovedAt, lastProgressAt: improved ? new Date() : existing?.lastProgressAt, status: nextStatus, stuckDetectedAt: improved || completed ? null : existing?.stuckDetectedAt }, create: { participantId: participant.id, stageProblemId: submission.trainingStageProblemId!, attemptCount: 1, bestScore, bestVerdict: submission.result, acAt: accepted ? new Date() : null, lastSubmissionAt: new Date(), lastScoreImprovedAt: new Date(), lastProgressAt: new Date(), status: completed ? 'COMPLETED' : 'WORKING' } })
    await tx.trainingSessionScoreEvent.create({ data: { sessionId: submission.trainingSessionId!, participantId: participant.id, stageProblemId: submission.trainingStageProblemId!, submissionId: submission.id, score: submission.score, verdict: submission.result } })
    if (existing?.status === 'STUCK' && (improved || completed)) {
      await appendEvent(tx, submission.trainingSessionId!, TrainingEventTypes.PROBLEM_STUCK_CLEARED, 'USER', submission.userId, {
        participantId: participant.id,
        stageProblemId: submission.trainingStageProblemId,
        reason: completed ? 'completed' : 'score_improved',
        at: new Date().toISOString(),
      })
    }
    await appendEvent(tx, submission.trainingSessionId!, TrainingEventTypes.PROGRESS_UPDATED, 'USER', submission.userId, { stageProblemId: submission.trainingStageProblemId, score: submission.score, verdict: submission.result })
  })
}
