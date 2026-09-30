import crypto from 'node:crypto'
import yaml from 'js-yaml'
import type { Prisma, TrainingEngineSessionStatus, TrainingEngineTargetType } from '@prisma/client'
import { prisma } from '../../prisma'
import { isOrganizationContestAdmin, isOrganizationMember, isTeamAdmin, isTeamMember } from './training-auth.service'
import { createQueuedSubmissionWithRun } from '../judge/application/judge-run.service'
import { normalizeSubmissionIo } from '../judge/domain/submission-io'
import { BUILTIN_TRAINING_TEMPLATES, getBuiltinTrainingTemplate } from './training-engine.templates'
import { flattenTrainingDesignParticipants } from './training-engine.design'
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
  'OPEN_HINT', 'CLOSE_HINT', 'UNLOCK_FOR_USER', 'SKIP_FOR_USER', 'CLEAR_STUCK_FOR_USER', 'MOVE_GROUP', 'SHOW_MESSAGE', 'CLEAR_MESSAGE', 'PUBLISH_RESULTS',
])
const SESSION_WIDE_COMMANDS = new Set([
  'PAUSE_SESSION', 'RESUME_SESSION', 'PUBLISH_RESULTS',
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
  PUBLISH_RESULTS: new Set(['RUNNING', 'PAUSED', 'ENDED']),
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


function trainingResultsHidden(session: { settings: unknown; status: string }, manager: boolean) {
  if (manager) return false
  const settings = parseJsonObject(session.settings)
  if (settings.resultVisibility === 'AFTER_END') return !['ENDED', 'ARCHIVED'].includes(session.status)
  if (settings.resultVisibility === 'TEACHER_PUBLISHED') return !settings.resultsPublishedAt
  return false
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
  const preset = ['practice', 'oi_exam', 'acm_exam'].includes(String(source.preset)) ? String(source.preset) : 'practice'
  const resultVisibility = ['LIVE', 'AFTER_END', 'TEACHER_PUBLISHED'].includes(String(source.resultVisibility))
    ? String(source.resultVisibility)
    : preset === 'practice' ? 'LIVE' : 'AFTER_END'
  return { dueAt: dueAt?.toISOString() || null, completionMode, requiredProblemCount, participantTarget, preset, resultVisibility, resultsPublishedAt: null }
}

export async function loadSession(id: string) {
  return prisma.trainingSession.findUnique({ where: { id }, include: {
    Stages: { orderBy: { orderIndex: 'asc' }, include: {
      Problems: { orderBy: { orderIndex: 'asc' }, include: { Problem: { select: { id: true, platform: true, problemId: true, title: true, difficulty: true, timeLimit: true, memoryLimit: true } }, Plans: { orderBy: { orderIndex: 'asc' } } } },
      Groups: { orderBy: { TrainingGroup: { orderIndex: 'asc' } }, include: { ProblemPlans: { orderBy: { orderIndex: 'asc' } }, TrainingGroup: true } },
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
  const definition = parseJsonObject(template.settings)
  const storedStages = Array.isArray(definition.stages) ? definition.stages : null
  return {
    key: 'database:' + template.id,
    name: template.name,
    sessionType: template.sessionType,
    description: template.description || '',
    source: template.organizationId ? 'organization' as const : template.teamId ? 'team' as const : 'personal' as const,
    problemCount: storedStages ? storedStages.reduce((sum: number, stage: any) => sum + (Array.isArray(stage.problems) ? stage.problems.length : 0), 0) : 0,
    stages: storedStages || template.Stages.map((stage: any) => {
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
    definition: Number(definition.version) >= 2 ? definition : null,
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
  const hints = await prisma.trainingSessionHint.findMany({ where: { sessionId }, orderBy: [{ stageProblemId: 'asc' }, { level: 'asc' }] })
  const hintsByProblem = new Map<string, any[]>()
  for (const hint of hints) hintsByProblem.set(hint.stageProblemId, [...(hintsByProblem.get(hint.stageProblemId) || []), hint])
  const definition = {
    version: 2,
    defaults: {
      defaultAccessPolicy: session.defaultAccessPolicy,
      defaultSubmissionMode: session.defaultSubmissionMode,
      allowHints: session.allowHints,
      rankingMode: session.rankingMode,
      peerVisibility: session.peerVisibility,
      joinMode: session.joinMode,
    },
    groups: session.Groups.map(group => ({ name: group.name, orderIndex: group.orderIndex })),
    stages: session.Stages.map(stage => {
      const defaultPlan = stage.Groups.find(plan => plan.isDefault)
      return {
        name: stage.name,
        description: stage.description || '',
        kind: stage.kind,
        mode: stage.mode,
        accessPolicy: stage.accessPolicy,
        submissionMode: stage.submissionMode,
        endPolicy: stage.endPolicy,
        plannedDurationSeconds: stage.plannedDurationSeconds,
        minDurationSeconds: stage.minDurationSeconds,
        completionThreshold: stage.completionThreshold,
        completionPolicy: stage.completionPolicy,
        rules: stage.rules,
        problems: stage.Problems.map(problem => {
          const plan = defaultPlan?.ProblemPlans.find(item => item.stageProblemId === problem.id)
          return {
            problemId: problem.problemId,
            alias: problem.alias,
            required: plan?.required !== false,
            unlockPolicy: plan?.unlockPolicy,
            targetScore: plan?.targetScore,
            scoreGoals: plan?.scoreGoals,
            timePolicy: plan?.timePolicy,
            stuckPolicy: plan?.stuckPolicy,
            hintPolicy: plan?.hintPolicy,
            allowedSubtaskIds: plan?.allowedSubtaskIds,
            strategyIntervalSeconds: plan?.strategyIntervalSeconds,
          }
        }),
        plans: stage.Groups.map(plan => ({
          groupName: plan.TrainingGroup?.name || null,
          isDefault: plan.isDefault,
          inheritsDefault: plan.inheritsDefault,
          accessPolicy: plan.accessPolicy,
          submissionMode: plan.submissionMode,
          completionPolicy: plan.completionPolicy,
          rules: plan.rules,
          problems: plan.ProblemPlans.map(problemPlan => {
            const problem = stage.Problems.find(item => item.id === problemPlan.stageProblemId)
            return {
              problemId: problem?.problemId,
              required: problemPlan.required,
              orderIndex: problemPlan.orderIndex,
              unlockPolicy: problemPlan.unlockPolicy,
              targetScore: problemPlan.targetScore,
              scoreGoals: problemPlan.scoreGoals,
              timePolicy: problemPlan.timePolicy,
              stuckPolicy: problemPlan.stuckPolicy,
              hintPolicy: problemPlan.hintPolicy,
              allowedSubtaskIds: problemPlan.allowedSubtaskIds,
              judgeConfigProjection: problemPlan.judgeConfigProjection,
              strategyIntervalSeconds: problemPlan.strategyIntervalSeconds,
              rules: problemPlan.rules,
            }
          }).filter(item => item.problemId),
        })),
        hints: stage.Problems.flatMap(problem => (hintsByProblem.get(problem.id) || []).map(hint => ({
          problemId: problem.problemId,
          level: hint.level,
          title: hint.title,
          content: hint.content,
          openMode: hint.openMode,
          triggerSeconds: hint.triggerSeconds,
          triggerAttempts: hint.triggerAttempts,
          triggerScore: hint.triggerScore,
        }))),
      }
    }),
  }
  const key = 'custom-' + crypto.randomUUID()
  const created = await prisma.trainingSessionTemplate.create({
    data: {
      organizationId, teamId, key, name, sessionType: session.sessionType,
      description: session.description || null, createdBy: userId, settings: asJson(definition),
      Stages: { create: session.Stages.map((stage, orderIndex) => ({
        name: stage.name, description: stage.description, orderIndex, kind: stage.kind,
        plannedDurationSeconds: stage.plannedDurationSeconds,
        endPolicy: stage.endPolicy, accessPolicy: stage.accessPolicy, submissionMode: stage.submissionMode,
        rules: asJson({ ...parseJsonObject(stage.rules), _templateStage: { completionThreshold: stage.completionThreshold, minDurationSeconds: stage.minDurationSeconds, mode: stage.mode } }),
      })) },
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
  const problems = allProblemIds.length ? await prisma.problem.findMany({
    where: { id: { in: allProblemIds }, TestSetSlots: { some: {} }, status: { not: 'archived' }, ...(access && !access.canSeeAll ? { OR: [{ ownerId: access.userId }, { libraryScope: 'platform', status: 'published' }, ...(access.organizationId ? [{ libraryScope: 'school', organizationId: access.organizationId, status: 'published' }] : [])] } : {}) },
    include: {
      TestSetSlots: { orderBy: { slot: 'asc' }, include: { Subtasks: { select: { subtaskId: true, Dependencies: { select: { DependsOn: { select: { subtaskId: true } } } } } } } },
      ProblemStatement: { where: { isVisible: true }, orderBy: [{ type: 'asc' }, { format: 'asc' }, { language: 'asc' }] },
    },
  }) : []
  const byId = new Map(problems.map(item => [item.id, item]))
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
      if (!problem?.TestSetSlots.length) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_DATA_REQUIRED', `${label}的第 ${problemIndex + 1} 道题没有可用测试数据`)
      const slot = problem.TestSetSlots.find(item => item.slot === 'EVOLVING') || problem.TestSetSlots.find(item => item.slot === 'STABLE')!
      const requestedAllowedSubtaskIds = Array.isArray(item.allowedSubtaskIds) ? [...new Set(item.allowedSubtaskIds.map(Number))] : []
      if (requestedAllowedSubtaskIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new TrainingEngineError(422, 'UNKNOWN_TRAINING_SUBTASK', 'Subtask ID 必须是正整数')
      if (requestedAllowedSubtaskIds.length && slot.mode !== 'oi') throw new TrainingEngineError(422, 'SUBTASK_PROJECTION_UNSUPPORTED', '仅 OI Revision 支持按 Subtask 训练')
      const slotSubtasks = Array.isArray((slot as any).Subtasks) ? (slot as any).Subtasks as Array<{ subtaskId: number; Dependencies: Array<{ DependsOn: { subtaskId: number } }> }> : []
      const dependencyMap = new Map(slotSubtasks.map(subtask => [subtask.subtaskId, subtask.Dependencies.map(dependency => dependency.DependsOn.subtaskId)]))
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
        const config = yaml.load(slot.judgeConfig) as any
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
      }, problem, slot, problemIndex, allowedSubtaskIds, projection }
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
  const config = entry.stage
  const stage = await tx.trainingSessionStage.create({ data: {
    sessionId,
    name: entry.name,
    description: config.description?.trim() || null,
    orderIndex: entry.stageIndex,
    kind: config.kind,
    mode: String(config.mode || config.trainingMode || (config.kind === 'REVIEW' ? 'REVIEW' : 'PRACTICE')),
    accessPolicy: config.accessPolicy,
    submissionMode: config.submissionMode,
    endPolicy: config.endPolicy,
    plannedDurationSeconds: config.plannedDurationSeconds,
    minDurationSeconds: boundedInteger(config.minDurationSeconds, 0, 86400, '最短阶段时长'),
    completionThreshold: config.completionThreshold,
    completionPolicy: asJson(config.completionPolicy),
    rules: asJson(config.rules),
  } })

  const stageProblems: any[] = []
  for (const item of entry.stageProblems) {
    const saved = await tx.trainingSessionStageProblem.create({ data: {
      stageId: stage.id,
      problemId: item.problem.id,
      alias: item.item.alias?.trim() || null,
      orderIndex: stageProblems.length,
      titleSnapshot: item.problem.title,
      statementsSnapshot: asJson(item.problem.ProblemStatement.map((statement: any) => ({
        type: statement.type,
        format: statement.format,
        language: statement.language,
        content: statement.content,
        fileUrl: statement.fileUrl,
      }))),
    } })
    stageProblems.push({ saved, source: item })
  }

  const defaultPlan = await tx.trainingSessionStageGroup.create({ data: {
    stageId: stage.id,
    groupId: null,
    isDefault: true,
    inheritsDefault: false,
    accessPolicy: config.accessPolicy,
    submissionMode: config.submissionMode,
    completionPolicy: asJson(config.completionPolicy),
    rules: asJson(config.rules),
  } })
  for (const [orderIndex, item] of stageProblems.entries()) {
    await tx.trainingSessionStageProblemPlan.create({ data: {
      stageId: stage.id,
      stageProblemId: item.saved.id,
      stageGroupId: defaultPlan.id,
      required: item.source.item.required !== false,
      orderIndex,
      unlockPolicy: asJson(item.source.item.unlockPolicy),
      targetScore: boundedInteger(item.source.item.targetScore, 0, 100, '题目目标分数'),
      scoreGoals: asJson(item.source.item.scoreGoals),
      timePolicy: asJson(item.source.item.timePolicy),
      stuckPolicy: asJson(item.source.item.stuckPolicy),
      hintPolicy: asJson(item.source.item.hintPolicy),
      allowedSubtaskIds: item.source.allowedSubtaskIds.length ? item.source.allowedSubtaskIds : undefined,
      judgeConfigProjection: item.source.projection,
      strategyIntervalSeconds: boundedInteger(item.source.item.strategyIntervalSeconds, 60, 86400, '策略检查间隔'),
    } })
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

async function applyTrainingTemplateDefinition(tx: any, sessionId: string, definition: any, createdBy: string) {
  if (!definition || Number(definition.version) < 2 || !Array.isArray(definition.stages)) return
  const [stages, groups] = await Promise.all([
    tx.trainingSessionStage.findMany({ where: { sessionId }, orderBy: { orderIndex: 'asc' }, include: { Problems: true } }),
    tx.trainingSessionGroup.findMany({ where: { sessionId }, orderBy: { orderIndex: 'asc' } }),
  ])
  const groupByName = new Map(groups.map((group: any) => [group.name, group]))
  for (const [stageIndex, storedStage] of definition.stages.entries()) {
    const stage = stages[stageIndex]
    if (!stage) continue
    const problemByCanonicalId = new Map(stage.Problems.map((problem: any) => [problem.problemId, problem]))
    if (Array.isArray(storedStage.plans) && storedStage.plans.length) {
      await tx.trainingSessionStageGroup.deleteMany({ where: { stageId: stage.id } })
      for (const storedPlan of storedStage.plans) {
        const trainingGroup = storedPlan.groupName ? groupByName.get(String(storedPlan.groupName)) as any : null
        if (storedPlan.groupName && !trainingGroup) throw new TrainingEngineError(422, 'TRAINING_TEMPLATE_GROUP_INVALID', '模板引用了不存在的训练组')
        const plan = await tx.trainingSessionStageGroup.create({ data: {
          stageId: stage.id,
          groupId: trainingGroup?.id || null,
          isDefault: Boolean(storedPlan.isDefault),
          inheritsDefault: storedPlan.inheritsDefault !== false,
          accessPolicy: enumValue(storedPlan.accessPolicy, ACCESS_POLICIES, stage.accessPolicy, '模板开放方式') as any,
          submissionMode: enumValue(storedPlan.submissionMode, SUBMISSION_MODES, stage.submissionMode, '模板提交方式') as any,
          completionPolicy: asJson(storedPlan.completionPolicy),
          rules: asJson(storedPlan.rules),
        } })
        for (const [orderIndex, storedProblem] of (Array.isArray(storedPlan.problems) ? storedPlan.problems : []).entries()) {
          const problem = problemByCanonicalId.get(String(storedProblem.problemId)) as any
          if (!problem) throw new TrainingEngineError(422, 'TRAINING_TEMPLATE_PROBLEM_INVALID', '模板分组方案引用了不存在的训练题')
          await tx.trainingSessionStageProblemPlan.create({ data: {
            stageId: stage.id,
            stageProblemId: problem.id,
            stageGroupId: plan.id,
            required: storedProblem.required !== false,
            orderIndex,
            unlockPolicy: asJson(storedProblem.unlockPolicy),
            targetScore: storedProblem.targetScore == null ? null : Number(storedProblem.targetScore),
            scoreGoals: asJson(storedProblem.scoreGoals),
            timePolicy: asJson(storedProblem.timePolicy),
            stuckPolicy: asJson(storedProblem.stuckPolicy),
            hintPolicy: asJson(storedProblem.hintPolicy),
            allowedSubtaskIds: asJson(storedProblem.allowedSubtaskIds),
            judgeConfigProjection: storedProblem.judgeConfigProjection || null,
            strategyIntervalSeconds: storedProblem.strategyIntervalSeconds == null ? null : Number(storedProblem.strategyIntervalSeconds),
            rules: asJson(storedProblem.rules),
          } })
        }
      }
    }
    for (const storedHint of (Array.isArray(storedStage.hints) ? storedStage.hints : [])) {
      const problem = problemByCanonicalId.get(String(storedHint.problemId)) as any
      if (!problem) continue
      await tx.trainingSessionHint.create({ data: {
        sessionId,
        stageProblemId: problem.id,
        level: Number(storedHint.level),
        title: storedHint.title || null,
        content: String(storedHint.content || ''),
        openMode: storedHint.openMode || 'MANUAL',
        triggerSeconds: storedHint.triggerSeconds == null ? null : Number(storedHint.triggerSeconds),
        triggerAttempts: storedHint.triggerAttempts == null ? null : Number(storedHint.triggerAttempts),
        triggerScore: storedHint.triggerScore == null ? null : Number(storedHint.triggerScore),
        createdBy,
      } })
    }
  }
}

function trainingDefinitionSnapshot(session: any, hints: any[]) {
  const hintsByProblem = new Map<string, any[]>()
  for (const hint of hints) hintsByProblem.set(hint.stageProblemId, [...(hintsByProblem.get(hint.stageProblemId) || []), hint])
  return {
    version: 2,
    defaults: {
      defaultAccessPolicy: session.defaultAccessPolicy,
      defaultSubmissionMode: session.defaultSubmissionMode,
      allowHints: session.allowHints,
      rankingMode: session.rankingMode,
      peerVisibility: session.peerVisibility,
      joinMode: session.joinMode,
    },
    groups: session.Groups.map((group: any) => ({ name: group.name, orderIndex: group.orderIndex })),
    stages: session.Stages.map((stage: any) => {
      const defaultPlan = stage.Groups.find((plan: any) => plan.isDefault)
      return {
        name: stage.name,
        description: stage.description || '',
        kind: stage.kind,
        mode: stage.mode,
        accessPolicy: stage.accessPolicy,
        submissionMode: stage.submissionMode,
        endPolicy: stage.endPolicy,
        plannedDurationSeconds: stage.plannedDurationSeconds,
        minDurationSeconds: stage.minDurationSeconds,
        completionThreshold: stage.completionThreshold,
        completionPolicy: stage.completionPolicy,
        rules: stage.rules,
        problems: stage.Problems.map((problem: any) => {
          const plan = defaultPlan?.ProblemPlans.find((item: any) => item.stageProblemId === problem.id)
          return {
            problemId: problem.problemId,
            alias: problem.alias,
            required: plan?.required !== false,
            unlockPolicy: plan?.unlockPolicy,
            targetScore: plan?.targetScore,
            scoreGoals: plan?.scoreGoals,
            timePolicy: plan?.timePolicy,
            stuckPolicy: plan?.stuckPolicy,
            hintPolicy: plan?.hintPolicy,
            allowedSubtaskIds: plan?.allowedSubtaskIds,
            strategyIntervalSeconds: plan?.strategyIntervalSeconds,
          }
        }),
        plans: stage.Groups.map((plan: any) => ({
          groupName: plan.TrainingGroup?.name || null,
          isDefault: plan.isDefault,
          inheritsDefault: plan.inheritsDefault,
          accessPolicy: plan.accessPolicy,
          submissionMode: plan.submissionMode,
          completionPolicy: plan.completionPolicy,
          rules: plan.rules,
          problems: plan.ProblemPlans.map((problemPlan: any) => {
            const problem = stage.Problems.find((item: any) => item.id === problemPlan.stageProblemId)
            return {
              problemId: problem?.problemId,
              required: problemPlan.required,
              orderIndex: problemPlan.orderIndex,
              unlockPolicy: problemPlan.unlockPolicy,
              targetScore: problemPlan.targetScore,
              scoreGoals: problemPlan.scoreGoals,
              timePolicy: problemPlan.timePolicy,
              stuckPolicy: problemPlan.stuckPolicy,
              hintPolicy: problemPlan.hintPolicy,
              allowedSubtaskIds: problemPlan.allowedSubtaskIds,
              judgeConfigProjection: problemPlan.judgeConfigProjection,
              strategyIntervalSeconds: problemPlan.strategyIntervalSeconds,
              rules: problemPlan.rules,
            }
          }).filter((item: any) => item.problemId),
        })),
        hints: stage.Problems.flatMap((problem: any) => (hintsByProblem.get(problem.id) || []).map((hint: any) => ({
          problemId: problem.problemId,
          level: hint.level,
          title: hint.title,
          content: hint.content,
          openMode: hint.openMode,
          triggerSeconds: hint.triggerSeconds,
          triggerAttempts: hint.triggerAttempts,
          triggerScore: hint.triggerScore,
        }))),
      }
    }),
  }
}

export async function createTrainingSession(userId: string, body: any, definitionOverride?: any) {
  assertTrainingDefinitionWritesEnabled()
  const scope = await assertScopeManagement(userId, body || {})
  const template = await resolveTrainingTemplate(userId, body?.templateKey, scope)
  const storedDefinition = (template as any)?.definition && Number((template as any).definition.version) >= 2 ? (template as any).definition : null
  const templateDefinition = definitionOverride || storedDefinition
  const templateDefaults = parseJsonObject(templateDefinition?.defaults)
  const sessionType = enumValue(body?.sessionType || template?.sessionType, SESSION_TYPES, 'GENERAL', '训练类型')
  const defaultAccessPolicy = enumValue(body?.defaultAccessPolicy || templateDefaults.defaultAccessPolicy, ACCESS_POLICIES, 'ALL_AT_ONCE', '默认题目开放方式')
  const defaultSubmissionMode = enumValue(body?.defaultSubmissionMode || templateDefaults.defaultSubmissionMode, SUBMISSION_MODES, 'ENABLED', '默认提交方式')
  const rankingMode = enumValue(body?.rankingMode || templateDefaults.rankingMode, RANKING_MODES, 'PROGRESS_ONLY', '训练榜单方式')
  const peerVisibility = enumValue(body?.peerVisibility || templateDefaults.peerVisibility, PEER_VISIBILITY, 'PROGRESS', '同学状态可见性')
  const joinMode = enumValue(body?.joinMode || templateDefaults.joinMode, JOIN_MODES, 'CURRENT_STAGE', '迟到加入方式')
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
      allowHints: body?.allowHints !== undefined ? body.allowHints !== false : templateDefaults.allowHints !== false, rankingMode: rankingMode as any, peerVisibility: peerVisibility as any, joinMode: joinMode as any,
      settings: asJson(requestedParticipantIds.length ? { ...settings, rosterExplicit: true } : settings),
    } })
    const templateGrouping = templateDefinition && Array.isArray(templateDefinition.groups) && templateDefinition.groups.length
      ? { groups: templateDefinition.groups.map((group: any, index: number) => ({ clientKey: 'template-group-' + index, name: String(group.name), participantIds: [] })) }
      : undefined
    await createGroupsAndParticipants(tx, id, requestedParticipantIds, body?.grouping || templateGrouping)
    for (const entry of hydrated) await createStageGraph(tx, id, entry)
    await applyTrainingTemplateDefinition(tx, id, templateDefinition, userId)
  })
  return loadSession(id)
}

export async function cloneTrainingSession(userId: string, sessionId: string, body: any) {
  const source = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  if (expectedRevision !== source.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
  const hints = await prisma.trainingSessionHint.findMany({ where: { sessionId }, orderBy: [{ stageProblemId: 'asc' }, { level: 'asc' }] })
  const definition = trainingDefinitionSnapshot(source, hints)
  const title = body?.title ? boundedText(body.title, 200, '训练名称', 1) : boundedText(source.title + '（副本）', 200, '训练名称', 1)
  const { participantTarget: _participantTarget, rosterExplicit: _rosterExplicit, ...cloneSettings } = parseJsonObject(source.settings)
  return createTrainingSession(userId, {
    title,
    description: source.description || undefined,
    organizationId: source.organizationId || undefined,
    teamId: source.teamId || undefined,
    participantUserIds: [],
    sessionType: source.sessionType,
    scheduledStartAt: null,
    rankingMode: source.rankingMode,
    peerVisibility: source.peerVisibility,
    joinMode: source.joinMode,
    allowHints: source.allowHints,
    defaultAccessPolicy: source.defaultAccessPolicy,
    defaultSubmissionMode: source.defaultSubmissionMode,
    settings: { ...cloneSettings, clonedFromSessionId: source.id },
    grouping: { groups: definition.groups.map((group: any, index: number) => ({ clientKey: 'clone-group-' + index, name: group.name, participantIds: [] })) },
    stages: definition.stages,
  }, definition)
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
  const slots = problemIds.length ? await prisma.problemTestSetSlot.findMany({
    where: { problemId: { in: problemIds } },
    include: { Subtasks: { orderBy: { orderIndex: 'asc' }, select: { subtaskId: true, score: true, Dependencies: { select: { DependsOn: { select: { subtaskId: true } } } } } } },
  }) : []
  const currentByProblem = new Map<string, typeof slots[number]>()
  for (const slot of slots) {
    const current = currentByProblem.get(slot.problemId)
    if (!current || slot.slot === 'EVOLVING') currentByProblem.set(slot.problemId, slot)
  }

  const stages = session.Stages.map((stage, stageIndex) => {
    const defaultPlan = stage.Groups.find(plan => plan.isDefault)
    const plans = (defaultPlan?.ProblemPlans || []).slice().sort((a, b) => a.orderIndex - b.orderIndex)
    const problems = plans.map(plan => {
      const problem = stage.Problems.find(item => item.id === plan.stageProblemId)!
      return {
        ...problem,
        ...plan,
        id: problem.id,
        planId: plan.id,
        assignmentId: problem.id,
        clientKey: plan.id,
        required: plan.required,
        currentData: currentByProblem.get(problem.problemId) ? {
          slot: currentByProblem.get(problem.problemId)!.slot,
          graphHash: currentByProblem.get(problem.problemId)!.graphHash,
          mode: currentByProblem.get(problem.problemId)!.mode,
        } : null,
        subtasks: currentByProblem.get(problem.problemId)?.Subtasks.map(item => ({ id: item.subtaskId, score: item.score, dependencies: item.Dependencies.map(dependency => dependency.DependsOn.subtaskId) })) || [],
      }
    })
    return {
      ...stage,
      clientKey: stage.id,
      orderIndex: stageIndex,
      editable: stage.lifecycle === 'PENDING',
      Problems: problems,
      Groups: [],
      accessScope: normalizeTrainingAccessScope(parseJsonObject(stage.rules).accessScope),
      effectiveDurationSeconds: (stage.plannedDurationSeconds || 0) + stage.TimeAdjustments.reduce((sum, item) => sum + item.seconds, 0),
    }
  })
  const stagePlans = session.Stages.flatMap(stage => stage.Groups.map(plan => ({
    id: plan.id,
    clientKey: plan.id,
    stageId: stage.id,
    stageName: stage.name,
    groupId: plan.groupId,
    groupName: plan.TrainingGroup?.name || null,
    isDefault: plan.isDefault,
    inheritsDefault: plan.inheritsDefault,
    accessPolicy: plan.accessPolicy,
    submissionMode: plan.submissionMode,
    completionPolicy: plan.completionPolicy,
    rules: plan.rules,
    problemIds: plan.ProblemPlans.map(item => item.stageProblemId),
    requiredProblemIds: plan.ProblemPlans.filter(item => item.required).map(item => item.stageProblemId),
  })))
  const groups = session.Groups.map(group => ({
    id: group.id,
    clientKey: group.id,
    name: group.name,
    orderIndex: group.orderIndex,
    status: group.status,
    participantIds: group.Participants.filter(item => item.status === 'active').map(item => item.userId),
  }))
  const payloadStages = stages.map(stage => ({ ...stage, problems: stage.Problems })) as unknown as StructureStage[]
  return {
    editable: !['ENDED', 'ARCHIVED'].includes(session.status),
    statusRevision: session.statusRevision,
    session: {
      id: session.id,
      title: session.title,
      description: session.description,
      sessionType: session.sessionType,
      status: session.status,
      currentStageId: session.currentStageId,
      organizationId: session.organizationId,
      teamId: session.teamId,
      scheduledStartAt: session.scheduledStartAt,
      rankingMode: session.rankingMode,
      peerVisibility: session.peerVisibility,
      joinMode: session.joinMode,
      allowHints: session.allowHints,
    },
    participants: flattenTrainingDesignParticipants(session.Groups),
    groups,
    stages,
    stagePlans,
    issues: structureIssues(payloadStages),
  }
}

export async function getTrainingDesignProblem(userId: string, sessionId: string, problemId: string) {
  const session = await assertManage(userId, sessionId)
  const team = session.teamId ? await prisma.team.findUnique({ where: { id: session.teamId }, select: { organizationId: true } }) : null
  const organizationId = session.organizationId || team?.organizationId || null
  const problem = await prisma.problem.findFirst({
    where: {
      id: problemId,
      TestSetSlots: { some: {} },
      status: { not: 'archived' },
      OR: [
        { libraryScope: 'platform', status: 'published' },
        { ownerId: userId },
        ...(organizationId ? [{ libraryScope: 'school', organizationId, status: 'published' }] : []),
      ],
    },
    include: { TestSetSlots: { include: { Subtasks: { orderBy: { orderIndex: 'asc' }, select: { subtaskId: true, score: true, Dependencies: { select: { DependsOn: { select: { subtaskId: true } } } } } } } } },
  })
  const slot = problem?.TestSetSlots.find(item => item.slot === 'EVOLVING') || problem?.TestSetSlots.find(item => item.slot === 'STABLE')
  if (!problem || !slot) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_AVAILABLE', '题目不存在、不可用或没有测试数据')
  return {
    id: problem.id,
    platform: problem.platform,
    problemId: problem.problemId,
    title: problem.title,
    difficulty: problem.difficulty,
    data: { slot: slot.slot, graphHash: slot.graphHash, mode: slot.mode },
    subtasks: slot.Subtasks.map(item => ({ id: item.subtaskId, score: item.score, dependencies: item.Dependencies.map(dependency => dependency.DependsOn.subtaskId) })),
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
    const existing = await tx.trainingSessionStage.findMany({ where: { sessionId }, select: { lifecycle: true } })
    if (existing.some(stage => stage.lifecycle !== 'PENDING')) throw new TrainingEngineError(409, 'TRAINING_STRUCTURE_FROZEN', '已有阶段开始后不能整体替换训练结构，请只编辑未来阶段')
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
  const invalidStage = session.Stages.find(stage => stage.kind === 'TRAINING' && !(stage.Groups.find(plan => plan.isDefault)?.ProblemPlans.length))
  if (invalidStage) throw new TrainingEngineError(422, 'TRAINING_STAGE_EMPTY', '每个训练阶段的默认计划至少需要一道题')
  const nextStatus = session.scheduledStartAt && session.scheduledStartAt > new Date() ? 'SCHEDULED' : 'RUNNING'
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision || current.status !== 'DRAFT') throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    await tx.trainingSession.update({ where: { id: sessionId }, data: { status: nextStatus as any, statusRevision: { increment: 1 } } })
    if (nextStatus === 'RUNNING') {
      const firstStage = await tx.trainingSessionStage.findFirst({ where: { sessionId }, orderBy: { orderIndex: 'asc' } })
      if (!firstStage) throw new TrainingEngineError(422, 'TRAINING_STAGE_REQUIRED', '训练至少需要一个阶段')
      await startGlobalStage(tx, sessionId, firstStage.id, userId)
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
    participant: { ...participant, currentGroupId: participant.groupId },
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
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item)).join(',') + '}'
  return JSON.stringify(value)
}
function stageElapsed(stage: { runningSince: Date | null }, at: Date) { return stage.runningSince ? Math.max(0, Math.floor((at.getTime() - stage.runningSince.getTime()) / 1000)) : 0 }

async function createStageSnapshot(tx: Prisma.TransactionClient, stageId: string, actorUserId: string | null) {
  const stage = await tx.trainingSessionStage.findUniqueOrThrow({ where: { id: stageId }, include: { Problems: { orderBy: { orderIndex: 'asc' } }, Groups: { include: { ProblemPlans: { orderBy: { orderIndex: 'asc' } } } }, TimeAdjustments: { orderBy: { createdAt: 'asc' } } } })
  const config = {
    stage: { id: stage.id, name: stage.name, orderIndex: stage.orderIndex, kind: stage.kind, mode: stage.mode, accessPolicy: stage.accessPolicy, submissionMode: stage.submissionMode, endPolicy: stage.endPolicy, plannedDurationSeconds: stage.plannedDurationSeconds, minDurationSeconds: stage.minDurationSeconds, completionThreshold: stage.completionThreshold, completionPolicy: stage.completionPolicy, rules: stage.rules, definitionRevision: stage.definitionRevision },
    problems: stage.Problems.map(problem => ({ id: problem.id, problemId: problem.problemId, orderIndex: problem.orderIndex })),
    plans: stage.Groups.map(plan => ({ id: plan.id, groupId: plan.groupId, isDefault: plan.isDefault, inheritsDefault: plan.inheritsDefault, accessPolicy: plan.accessPolicy, submissionMode: plan.submissionMode, completionPolicy: plan.completionPolicy, rules: plan.rules, problems: plan.ProblemPlans.map(problem => ({ stageProblemId: problem.stageProblemId, orderIndex: problem.orderIndex, required: problem.required, unlockPolicy: problem.unlockPolicy, targetScore: problem.targetScore, scoreGoals: problem.scoreGoals, timePolicy: problem.timePolicy, stuckPolicy: problem.stuckPolicy, hintPolicy: problem.hintPolicy, allowedSubtaskIds: problem.allowedSubtaskIds, judgeConfigProjection: problem.judgeConfigProjection, strategyIntervalSeconds: problem.strategyIntervalSeconds, rules: problem.rules })) })),
    timeAdjustments: stage.TimeAdjustments,
  }
  const configHash = crypto.createHash('sha256').update(stableJson(config)).digest('hex')
  return tx.trainingSessionStageRuntimeSnapshot.upsert({ where: { stageId }, update: {}, create: { stageId, sessionId: stage.sessionId, definitionRevision: stage.definitionRevision, config: asJson(config)!, configHash, startedBy: actorUserId } })
}

async function startGlobalStage(tx: Prisma.TransactionClient, sessionId: string, stageId: string, actorUserId: string | null) {
  const session = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId }, select: { currentStageId: true, startedAt: true } })
  if (session.currentStageId) throw new TrainingEngineError(409, 'TRAINING_STAGE_ALREADY_RUNNING', '当前已有运行中的阶段')
  const stage = await tx.trainingSessionStage.findFirst({ where: { id: stageId, sessionId } })
  if (!stage) throw new TrainingEngineError(404, 'TRAINING_STAGE_NOT_FOUND', '阶段不存在')
  if (stage.lifecycle !== 'PENDING') throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_PENDING', '只能开始尚未运行的阶段')
  const pendingChanges = await tx.trainingSessionGroupChange.findMany({ where: { sessionId, effectiveMode: 'NEXT_STAGE', targetStageId: stageId, status: 'pending' }, orderBy: { createdAt: 'asc' } })
  for (const change of pendingChanges) {
    await tx.trainingSessionParticipant.updateMany({ where: { id: change.participantId, sessionId, status: 'active' }, data: { groupId: change.toGroupId, currentProblemId: null } })
    await tx.trainingSessionGroupChange.update({ where: { id: change.id }, data: { status: 'applied', appliedAt: new Date(), effectiveAt: new Date() } })
  }
  await createStageSnapshot(tx, stageId, actorUserId)
  const now = new Date()
  await tx.trainingSessionStage.update({ where: { id: stageId }, data: { lifecycle: 'RUNNING', startedAt: now, runningSince: now, endedAt: null, endReason: null, endedBy: null } })
  await tx.trainingSession.update({ where: { id: sessionId }, data: { currentStageId: stageId, status: 'RUNNING', startedAt: session.startedAt || now, runningSince: now, pausedAt: null, pauseMode: null } })
}

async function finishGlobalStage(tx: Prisma.TransactionClient, sessionId: string, stageId: string, actorUserId: string | null, outcome: 'completed' | 'ended_early', reason: string | null) {
  const stage = await tx.trainingSessionStage.findFirst({ where: { id: stageId, sessionId } })
  if (!stage || stage.lifecycle !== 'RUNNING') throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '只能结束当前运行阶段')
  const now = new Date()
  await tx.trainingSessionStage.update({ where: { id: stage.id }, data: { lifecycle: 'ENDED', runningSince: null, activeElapsedSeconds: { increment: stageElapsed(stage, now) }, endedAt: now, endReason: outcome === 'ended_early' ? 'TEACHER_ENDED_EARLY' : 'TEACHER_ENDED', endedBy: actorUserId } })
  await tx.trainingSession.update({ where: { id: sessionId }, data: { currentStageId: null, runningSince: null } })
  if (reason) await appendEvent(tx, sessionId, 'STAGE_END_REASON', 'ALL', null, { stageId, outcome, reason })
}

type StageTransitionAction = 'start' | 'advance' | 'skip_pending' | 'end_session'
async function applyV2StageTransition(tx: Prisma.TransactionClient, sessionId: string, input: { action: StageTransitionAction; stageId: string; outcome?: 'completed' | 'ended_early'; nextStageId?: string | null; actorUserId: string | null; reason?: string | null }) {
  const session = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId }, include: { Stages: { orderBy: { orderIndex: 'asc' } } } })
  const stage = session.Stages.find(item => item.id === input.stageId)
  if (!stage) throw new TrainingEngineError(404, 'TRAINING_STAGE_NOT_FOUND', '阶段不存在')
  if (input.action === 'skip_pending') {
    if (stage.lifecycle !== 'PENDING' || session.currentStageId === stage.id) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_PENDING', '只能跳过尚未开始的阶段')
    await tx.trainingSessionStage.update({ where: { id: stage.id }, data: { lifecycle: 'SKIPPED', endedAt: new Date(), endReason: 'TEACHER_ENDED', endedBy: input.actorUserId } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'STAGE_SKIPPED', 'ALL', null, { stageId: stage.id, reason: input.reason })
    return
  }
  if (input.action === 'start') {
    if (!['SCHEDULED', 'RUNNING'].includes(session.status) || session.currentStageId) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '当前训练不能开始阶段')
    if (session.Stages.find(item => item.lifecycle === 'PENDING')?.id !== stage.id) throw new TrainingEngineError(409, 'TRAINING_NEXT_STAGE_INVALID', '只能启动时间轴中的第一个待运行阶段')
    await startGlobalStage(tx, sessionId, stage.id, input.actorUserId)
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, sessionId, TrainingEventTypes.SESSION_STARTED, 'ALL', null, { stageId: stage.id })
    return
  }
  if (session.currentStageId !== stage.id || stage.lifecycle !== 'RUNNING') throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '请求的阶段不是全局当前阶段')
  await finishGlobalStage(tx, sessionId, stage.id, input.actorUserId, input.outcome || 'completed', input.reason || null)
  if (input.action === 'end_session') {
    const now = new Date()
    await tx.trainingSessionStage.updateMany({ where: { sessionId, lifecycle: 'PENDING' }, data: { lifecycle: 'SKIPPED', endedAt: now, endReason: 'SESSION_ENDED', endedBy: input.actorUserId } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { status: 'ENDED', endedAt: now, pausedAt: null, pauseMode: null, statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, sessionId, TrainingEventTypes.SESSION_ENDED, 'ALL', null, { stageId: stage.id, reason: input.reason || null })
    return
  }
  const next = input.nextStageId ? session.Stages.find(item => item.id === input.nextStageId) : session.Stages.find(item => item.orderIndex > stage.orderIndex && item.lifecycle === 'PENDING')
  const earliest = session.Stages.find(item => item.orderIndex > stage.orderIndex && item.lifecycle === 'PENDING')
  if (!next || next.lifecycle !== 'PENDING' || earliest?.id !== next.id) throw new TrainingEngineError(409, 'TRAINING_NEXT_STAGE_INVALID', '只能推进到时间轴中的下一个待运行阶段')
  await startGlobalStage(tx, sessionId, next.id, input.actorUserId)
  await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
  await appendEvent(tx, sessionId, TrainingEventTypes.STAGE_ADVANCED, 'ALL', null, { fromStageId: stage.id, stageId: next.id, reason: input.reason || null })
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
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId }, select: { statusRevision: true } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    await applyV2StageTransition(tx, sessionId, { action, stageId: String(body?.stageId || ''), nextStageId: body?.nextStageId ? String(body.nextStageId) : null, outcome, actorUserId: userId, reason })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function endTrainingStage(userId: string, sessionId: string, stageId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  if (session.currentStageId !== stageId || !['RUNNING', 'PAUSED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '只能结束全局当前阶段')
  const next = session.Stages.find(stage => stage.lifecycle === 'PENDING')
  return executeStageTransition(userId, sessionId, { expectedRevision: Number(body?.expectedRevision), action: body?.endSession === true || !next ? 'end_session' : 'advance', stageId, outcome: body?.outcome === 'ended_early' ? 'ended_early' : 'completed', nextStageId: next?.id, reason: body?.reason })
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
    const source = await tx.trainingSessionStage.findFirst({ where: { id: stageId, sessionId }, include: { Problems: { include: { Hints: true }, orderBy: { orderIndex: 'asc' } }, Groups: { include: { ProblemPlans: { orderBy: { orderIndex: 'asc' } } } } } })
    if (!source) throw new TrainingEngineError(404, 'TRAINING_STAGE_NOT_FOUND', '阶段不存在')
    const maxOrder = await tx.trainingSessionStage.aggregate({ where: { sessionId }, _max: { orderIndex: true } })
    const clone = await tx.trainingSessionStage.create({ data: { sessionId, name: boundedText(body?.name || source.name + '（复制）', 200, '阶段名称', 1), description: source.description, orderIndex: (maxOrder._max.orderIndex ?? -1) + 1, kind: source.kind, mode: source.mode, accessPolicy: source.accessPolicy, submissionMode: source.submissionMode, endPolicy: source.endPolicy, plannedDurationSeconds: source.plannedDurationSeconds, minDurationSeconds: source.minDurationSeconds, completionThreshold: source.completionThreshold, completionPolicy: asJson(source.completionPolicy), rules: asJson(source.rules) } })
    cloneId = clone.id
    const problemMap = new Map<string, string>()
    for (const problem of source.Problems) {
      const created = await tx.trainingSessionStageProblem.create({ data: { stageId: clone.id, problemId: problem.problemId, alias: problem.alias, orderIndex: problem.orderIndex, titleSnapshot: problem.titleSnapshot, statementsSnapshot: asJson(problem.statementsSnapshot) } })
      problemMap.set(problem.id, created.id)
      for (const hint of problem.Hints) await tx.trainingSessionHint.create({ data: { sessionId, stageProblemId: created.id, level: hint.level, title: hint.title, content: hint.content, openMode: hint.openMode, triggerSeconds: hint.triggerSeconds, triggerAttempts: hint.triggerAttempts, triggerScore: hint.triggerScore, createdBy: userId } })
    }
    for (const plan of source.Groups) {
      const createdPlan = await tx.trainingSessionStageGroup.create({ data: { stageId: clone.id, groupId: plan.groupId, isDefault: plan.isDefault, inheritsDefault: plan.inheritsDefault, accessPolicy: plan.accessPolicy, submissionMode: plan.submissionMode, completionPolicy: asJson(plan.completionPolicy), rules: asJson(plan.rules) } })
      for (const problem of plan.ProblemPlans) await tx.trainingSessionStageProblemPlan.create({ data: { stageId: clone.id, stageProblemId: problemMap.get(problem.stageProblemId)!, stageGroupId: createdPlan.id, required: problem.required, orderIndex: problem.orderIndex, unlockPolicy: asJson(problem.unlockPolicy), targetScore: problem.targetScore, scoreGoals: asJson(problem.scoreGoals), timePolicy: asJson(problem.timePolicy), stuckPolicy: asJson(problem.stuckPolicy), hintPolicy: asJson(problem.hintPolicy), allowedSubtaskIds: asJson(problem.allowedSubtaskIds), judgeConfigProjection: problem.judgeConfigProjection, strategyIntervalSeconds: problem.strategyIntervalSeconds, rules: asJson(problem.rules) } })
    }
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
  })
  return { stageId: cloneId, design: await getTrainingDesign(userId, sessionId) }
}

export async function moveTrainingStageParticipant(userId: string, sessionId: string, stageId: string, body: any) {
  return changeTrainingStageGroup(userId, sessionId, stageId, body)
}

export async function getTrainingStageGroupSuggestions(userId: string, sessionId: string, _stageId: string) {
  const grouping = await getTrainingGrouping(userId, sessionId)
  return { suggestions: grouping.groups.map((group: any) => ({ groupId: group.id, groupName: group.name, participantIds: group.participantIds, reason: '保持当前稳定分组' })) }
}

export async function changeTrainingStageGroup(userId: string, sessionId: string, stageId: string, body: any) {
  await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  const participantIds = [...new Set<string>([...(Array.isArray(body?.participantIds) ? body.participantIds.map(String) : []), ...(body?.participantId ? [String(body.participantId)] : [])])]
  if (!participantIds.length) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_REQUIRED', '请选择至少一名学员')
  const toGroupId = String(body?.toGroupId || '')
  const effectiveMode = String(body?.effectiveMode || 'immediate').toUpperCase()
  if (!['IMMEDIATE', 'NEXT_STAGE'].includes(effectiveMode)) throw new TrainingEngineError(422, 'TRAINING_GROUP_CHANGE_MODE_INVALID', '换组生效方式不受支持')
  const reason = boundedText(body?.reason, 2000, '换组原因', 1)
  const targetStageId = effectiveMode === 'NEXT_STAGE' ? String(body?.targetStageId || stageId || '') : String(stageId || '')
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    const toGroup = await tx.trainingSessionGroup.findFirst({ where: { id: toGroupId, sessionId, status: 'active' } })
    if (!toGroup) throw new TrainingEngineError(404, 'TRAINING_GROUP_NOT_FOUND', '目标分组不存在')
    if (effectiveMode === 'NEXT_STAGE' && !await tx.trainingSessionStage.findFirst({ where: { id: targetStageId, sessionId, lifecycle: 'PENDING' } })) throw new TrainingEngineError(422, 'TRAINING_TARGET_STAGE_INVALID', '下一阶段换组必须指定尚未开始的阶段')
    if (effectiveMode === 'IMMEDIATE' && current.currentStageId !== targetStageId) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '立即换组只能作用于全局当前阶段')
    const participants = await tx.trainingSessionParticipant.findMany({ where: { id: { in: participantIds }, sessionId, status: 'active' } })
    if (participants.length !== participantIds.length) throw new TrainingEngineError(404, 'TRAINING_PARTICIPANT_NOT_FOUND', '部分学员不属于当前训练')
    for (const participant of participants) {
      if (effectiveMode === 'NEXT_STAGE') await tx.trainingSessionGroupChange.create({ data: { sessionId, participantId: participant.id, fromGroupId: participant.groupId, toGroupId: toGroup.id, reason, changedBy: userId, effectiveMode: 'NEXT_STAGE', targetStageId, status: 'pending' } })
      else if (participant.groupId !== toGroup.id) {
        await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { groupId: toGroup.id, currentProblemId: null } })
        await tx.trainingSessionGroupChange.create({ data: { sessionId, participantId: participant.id, fromGroupId: participant.groupId, toGroupId: toGroup.id, reason, changedBy: userId, effectiveMode: 'IMMEDIATE', targetStageId, status: 'applied', appliedAt: new Date() } })
      }
    }
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'GROUP_CHANGED', 'ALL', null, { participantIds, toGroupId, effectiveMode, targetStageId, reason })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function extendTrainingStageTime(userId: string, sessionId: string, stageId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  const seconds = boundedInteger(body?.seconds, 60, 24 * 3600, '延长时长', false)!
  const reason = boundedText(body?.reason, 2000, '延时原因', 1)
  if (expectedRevision !== session.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision || current.currentStageId !== stageId) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '只能延长全局当前阶段')
    await tx.trainingSessionStageTimeAdjustment.create({ data: { stageId, seconds, reason, createdBy: userId } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, sessionId, TrainingEventTypes.STAGE_TIME_EXTENDED, 'ALL', null, { stageId, seconds, reason })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function appendTrainingRuntimeProblem(userId: string, sessionId: string, stageId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  if (!['RUNNING', 'PAUSED'].includes(session.status) || session.currentStageId !== stageId) throw new TrainingEngineError(409, 'TRAINING_RUNTIME_PROBLEM_STAGE_INVALID', '只能向全局当前阶段追加训练题')
  const expectedRevision = Number(body?.expectedRevision)
  const targetType = String(body?.targetType || 'ALL').toUpperCase()
  const targetId = targetType === 'ALL' ? null : String(body?.targetId || '')
  const required = body?.required !== false
  const targetScore = boundedInteger(body?.targetScore, 0, 100, '目标分数', false)!
  const reason = boundedText(body?.reason, 2000, '加题原因', 1)
  if (!['ALL', 'GROUP', 'USER'].includes(targetType)) throw new TrainingEngineError(422, 'TRAINING_RUNTIME_PROBLEM_TARGET_INVALID', '临时加题对象不受支持')
  if (targetType !== 'ALL' && !targetId) throw new TrainingEngineError(422, 'TRAINING_RUNTIME_PROBLEM_TARGET_REQUIRED', '请选择临时加题对象')
  const [hydrated] = await hydrateStages([{
    name: '运行时追加题',
    kind: 'TRAINING',
    accessPolicy: 'ALL_AT_ONCE',
    submissionMode: 'ENABLED',
    endPolicy: 'MANUAL',
    problems: [{ problemId: String(body?.problemId || ''), targetScore }],
  }], await problemAccessContext(userId, session.organizationId, session.teamId))
  const source = hydrated?.stageProblems?.[0]
  if (!source) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_REQUIRED', '请选择需要追加的训练题')
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    if (!['RUNNING', 'PAUSED'].includes(current.status) || current.currentStageId !== stageId) throw new TrainingEngineError(409, 'TRAINING_RUNTIME_PROBLEM_STAGE_INVALID', '当前阶段已变化，无法追加题目')
    if (targetType === 'GROUP' && !await tx.trainingSessionGroup.findFirst({ where: { id: targetId!, sessionId, status: 'active' } })) throw new TrainingEngineError(404, 'TRAINING_GROUP_NOT_FOUND', '目标分组不存在')
    if (targetType === 'USER' && !await tx.trainingSessionParticipant.findFirst({ where: { sessionId, userId: targetId!, status: 'active' } })) throw new TrainingEngineError(404, 'TRAINING_PARTICIPANT_NOT_FOUND', '目标学员不在当前训练中')

    let stageProblem = await tx.trainingSessionStageProblem.findUnique({ where: { stageId_problemId: { stageId, problemId: source.problem.id } } })
    if (!stageProblem) {
      const maximum = await tx.trainingSessionStageProblem.aggregate({ where: { stageId }, _max: { orderIndex: true } })
      stageProblem = await tx.trainingSessionStageProblem.create({ data: {
        stageId,
        problemId: source.problem.id,
          alias: null,
        orderIndex: (maximum._max.orderIndex ?? -1) + 1,
        titleSnapshot: source.problem.title,
        statementsSnapshot: asJson(source.problem.ProblemStatement.map((statement: any) => ({
          type: statement.type,
          format: statement.format,
          language: statement.language,
          content: statement.content,
          fileUrl: statement.fileUrl,
        }))),
      } })
    }
    const duplicate = await tx.trainingSessionOverlay.findFirst({ where: { sessionId, type: 'RUNTIME_PROBLEM', status: 'active', stageProblemId: stageProblem.id, targetType: targetType as any, targetId } })
    if (duplicate) throw new TrainingEngineError(409, 'TRAINING_RUNTIME_PROBLEM_DUPLICATE', '该对象已经追加了这道训练题')
    const overlay = await tx.trainingSessionOverlay.create({ data: {
      sessionId,
      type: 'RUNTIME_PROBLEM',
      targetType: targetType as any,
      targetId,
      stageProblemId: stageProblem.id,
      payload: asJson({ required, targetScore, reason, runtime: true, canonicalProblemId: source.problem.id, problemId: source.problem.problemId, platform: source.problem.platform, title: stageProblem.titleSnapshot }),
      createdBy: userId,
    } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, sessionId, TrainingEventTypes.PROBLEM_APPENDED, targetType as TrainingEngineTargetType, targetId, { overlayId: overlay.id, stageId, stageProblemId: stageProblem.id, canonicalProblemId: source.problem.id, problemId: source.problem.problemId, platform: source.problem.platform, title: stageProblem.titleSnapshot, required, targetScore, reason })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function getTrainingWorkspace(userId: string, sessionId: string) {
  const session = await loadSession(sessionId)
  if (!session) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  const manager = await canManageSession(userId, session)
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  if (!manager && (participant?.status !== 'active' || session.status === 'DRAFT')) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不存在')
  const [progress, overrides, latestGroupChange] = await Promise.all([
    participant ? prisma.trainingSessionProblemProgress.findMany({ where: { participantId: participant.id } }) : Promise.resolve([]),
    participant && !manager ? prisma.trainingSessionUserOverride.findMany({ where: { sessionId, userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }) : Promise.resolve([]),
    participant && !manager ? prisma.trainingSessionGroupChange.findFirst({
      where: { sessionId, participantId: participant.id, status: 'applied', appliedAt: { not: null } },
      orderBy: { appliedAt: 'desc' },
      include: { FromGroup: { select: { name: true } }, ToGroup: { select: { name: true } } },
    }) : Promise.resolve(null),
  ])
  const participantView = participant ? { ...participant, currentGroupId: participant.groupId } : null
  const progressByProblem = new Map(progress.map(item => [item.stageProblemId, item]))
  const permissionContext: TrainingPermissionContext = { session: session as any, manager, participant: participantView, overrides, progressByProblem }
  const resolvedPermissions = resolveAllTrainingPermissions(permissionContext)
  const currentStageProblemIds = new Set(
    session.Stages.find(stage => stage.id === session.currentStageId)?.Problems.map(problem => problem.id) || [],
  )
  const metadataVisibleWhileLocked = new Set(['SEQUENTIAL_LOCK', 'FOCUS_REQUIRED', 'FOCUS_LOCK', 'PROBLEM_LOCKED'])
  const permissions = Object.fromEntries(Object.entries(resolvedPermissions).map(([stageProblemId, permission]) => [
    stageProblemId,
    {
      ...permission,
      canSeeMetadata: manager
        || permission.canView
        || (currentStageProblemIds.has(stageProblemId) && metadataVisibleWhileLocked.has(permission.reason)),
    },
  ]))
  const resultsHidden = trainingResultsHidden(session, manager)
  const requirements = participant ? resolveParticipantSessionRequirements(session as any, participant.id, progress) : []
  const activeRequirements = requirements.filter(item => item.state !== 'RETIRED')
  const completedRequirements = activeRequirements.filter(item => ['SATISFIED', 'BYPASSED'].includes(item.state))
  const visibleOverlays = manager || !participantView ? session.Overlays : session.Overlays.filter(overlay => targetApplies(overlay.targetType, overlay.targetId, participantView, session))
  const clientProgress = resultsHidden
    ? progress.map(item => ({ ...item, status: 'HIDDEN', bestScore: null, attemptCount: 0, activeSeconds: 0, continuousActiveSeconds: 0 }))
    : progress
  const snapshotProblem = (problem: any) => ({ ...problem, Problem: { ...problem.Problem, title: problem.titleSnapshot }, Statements: Array.isArray(problem.statementsSnapshot) ? problem.statementsSnapshot : [] })
  const snapshotStage = (stage: any) => {
    const defaultPlan = stage.Groups.find((plan: any) => plan.isDefault)
    const overridePlan = participant?.groupId ? stage.Groups.find((plan: any) => plan.groupId === participant.groupId) : null
    const effectiveProblemPlan = (problemId: string) => {
      const override = overridePlan?.ProblemPlans.find((plan: any) => plan.stageProblemId === problemId)
      const fallback = defaultPlan?.ProblemPlans.find((plan: any) => plan.stageProblemId === problemId)
      const planned = override || (overridePlan?.inheritsDefault === false ? null : fallback)
      const runtime = [...visibleOverlays].reverse().find((item: any) => item.type === 'RUNTIME_PROBLEM' && item.stageProblemId === problemId)
      return planned || (runtime ? parseJsonObject(runtime.payload) : null)
    }
    return {
      ...stage,
      Plans: stage.Groups.map((plan: any) => ({ ...plan, name: plan.TrainingGroup?.name || '默认计划' })),
      Groups: undefined,
      Problems: stage.Problems.map((problem: any) => {
        const configured = effectiveProblemPlan(problem.id)
        const payload = snapshotProblem({ ...problem, ...(configured || {}) })
        return manager || permissions[problem.id]?.canSeeMetadata ? payload : { ...payload, alias: null, Statements: [], Problem: { ...problem.Problem, platform: '', problemId: '', title: '未开放题目', difficulty: null } }
      }),
    }
  }
  const currentStage = session.currentStageId ? session.Stages.find(stage => stage.id === session.currentStageId) || null : null
  return {
    session: { ...session, currentStageId: session.currentStageId, currentStage: currentStage ? { id: currentStage.id, name: currentStage.name, orderIndex: currentStage.orderIndex, lifecycle: currentStage.lifecycle } : null, Stages: session.Stages.map(snapshotStage), Overlays: visibleOverlays },
    manager,
    participant: participantView ? {
      ...participantView,
      ...(resultsHidden ? {} : { requiredCount: activeRequirements.length, completedCount: completedRequirements.length }),
      requirements: resultsHidden ? [] : requirements.map(item => ({ stageId: item.stageId, stageProblemId: item.stageProblemId, state: item.state })),
      latestGroupChange: latestGroupChange ? {
        id: latestGroupChange.id,
        fromGroupName: latestGroupChange.FromGroup?.name || null,
        toGroupName: latestGroupChange.ToGroup.name,
        reason: latestGroupChange.reason,
        appliedAt: latestGroupChange.appliedAt,
      } : null,
    } : null,
    progress: clientProgress,
    permissions,
    strategy: {},
  }
}

export async function replaceTrainingRoster(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  if (!['DRAFT', 'SCHEDULED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_ROSTER_DEFINITION_FROZEN', '训练开始后请使用“加入训练”或“退出训练”记录运行时变更')
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

export async function joinTrainingParticipantRuntime(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  if (!['RUNNING', 'PAUSED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_RUNTIME_ROSTER_UNAVAILABLE', '只有进行中或暂停中的训练可以记录中途加入')
  const expectedRevision = Number(body?.expectedRevision)
  const participantUserId = String(body?.userId || '')
  const groupId = String(body?.groupId || '')
  const historyMode = String(body?.historyMode || 'absent')
  const reason = boundedText(body?.reason, 2000, '加入原因', 1)
  if (!['absent', 'makeup'].includes(historyMode)) throw new TrainingEngineError(422, 'TRAINING_JOIN_HISTORY_MODE_INVALID', '历史阶段处理方式不受支持')
  const eligible = new Set(await eligibleTrainingParticipantIds(session))
  if (!eligible.has(participantUserId)) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_OUT_OF_SCOPE', '学员不属于当前学校或团队')
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    if (!['RUNNING', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'TRAINING_RUNTIME_ROSTER_UNAVAILABLE', '训练状态已变化，无法加入学员')
    const group = await tx.trainingSessionGroup.findFirst({ where: { id: groupId, sessionId, status: 'active' } })
    if (!group) throw new TrainingEngineError(404, 'TRAINING_GROUP_NOT_FOUND', '目标分组不存在')
    const existing = await tx.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId: participantUserId } } })
    if (existing?.status === 'active') throw new TrainingEngineError(409, 'TRAINING_PARTICIPANT_ALREADY_ACTIVE', '学员已经在当前训练中')
    const joinedAt = new Date()
    const participant = await tx.trainingSessionParticipant.upsert({
      where: { sessionId_userId: { sessionId, userId: participantUserId } },
      update: { status: 'active', groupId, currentProblemId: null, returnProblemId: null, joinedAt },
      create: { sessionId, userId: participantUserId, groupId, joinedAt },
    })
    if (historyMode === 'absent' && current.currentStageId) {
      const activeStage = await tx.trainingSessionStage.findUnique({ where: { id: current.currentStageId }, select: { orderIndex: true } })
      if (activeStage) {
        const historicalProblems = await tx.trainingSessionStageProblem.findMany({
          where: { Stage: { sessionId, orderIndex: { lt: activeStage.orderIndex } } },
          select: { id: true },
        })
        if (historicalProblems.length) await tx.trainingSessionProblemProgress.createMany({
          data: historicalProblems.map(problem => ({ participantId: participant.id, stageProblemId: problem.id, status: 'SKIPPED' as const, lastProgressAt: joinedAt })),
          skipDuplicates: true,
        })
      }
    }
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, TrainingEventTypes.PARTICIPANT_JOINED, 'USER', participantUserId, { groupId, historyMode, reason, joinedBy: userId })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function leaveTrainingParticipantRuntime(userId: string, sessionId: string, participantId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  if (!['RUNNING', 'PAUSED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_RUNTIME_ROSTER_UNAVAILABLE', '只有进行中或暂停中的训练可以记录中途退出')
  const expectedRevision = Number(body?.expectedRevision)
  const reason = boundedText(body?.reason, 2000, '退出原因', 1)
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    if (!['RUNNING', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'TRAINING_RUNTIME_ROSTER_UNAVAILABLE', '训练状态已变化，无法退出学员')
    const participant = await tx.trainingSessionParticipant.findFirst({ where: { id: participantId, sessionId, status: 'active' } })
    if (!participant) throw new TrainingEngineError(404, 'TRAINING_PARTICIPANT_NOT_FOUND', '活动学员不存在')
    await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { status: 'left', currentProblemId: null, returnProblemId: null } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, TrainingEventTypes.PARTICIPANT_LEFT, 'USER', participant.userId, { participantId: participant.id, groupId: participant.groupId, reason, leftBy: userId })
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
  const stages = await tx.trainingSessionStage.findMany({ where: { sessionId }, include: { Groups: { include: { ProblemPlans: true } }, Problems: true } })
  for (const stage of stages) {
    let defaultPlan = stage.Groups.find(plan => plan.isDefault)
    if (!defaultPlan) {
      const created = await tx.trainingSessionStageGroup.create({ data: { stageId: stage.id, groupId: null, isDefault: true, inheritsDefault: false, accessPolicy: stage.accessPolicy || session.defaultAccessPolicy, submissionMode: stage.submissionMode || session.defaultSubmissionMode, completionPolicy: asJson(stage.completionPolicy), rules: asJson(stage.rules) } })
      defaultPlan = { ...created, ProblemPlans: [] }
    }
    const existingIds = new Set(defaultPlan.ProblemPlans.map(problem => problem.stageProblemId))
    for (const problem of stage.Problems.filter(problem => !existingIds.has(problem.id))) await tx.trainingSessionStageProblemPlan.create({ data: { stageId: stage.id, stageProblemId: problem.id, stageGroupId: defaultPlan.id, required: true, orderIndex: problem.orderIndex } })
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
  await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  const rawPlans = Array.isArray(body?.stagePlans) ? body.stagePlans : []
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练已被其他管理员修改，请刷新')
    const stages = await tx.trainingSessionStage.findMany({ where: { sessionId }, include: { Problems: true, Groups: { include: { ProblemPlans: true } } } })
    const groups = await tx.trainingSessionGroup.findMany({ where: { sessionId, status: 'active' } })
    const stageById = new Map(stages.map(stage => [stage.id, stage]))
    const groupIds = new Set(groups.map(group => group.id))
    const seen = new Set<string>()
    for (const raw of rawPlans) {
      const stage = stageById.get(String(raw.stageId))
      const groupId = raw.groupId ? String(raw.groupId) : null
      if (!stage || (groupId && !groupIds.has(groupId))) throw new TrainingEngineError(422, 'TRAINING_STAGE_PLAN_INVALID', '训练计划引用了无效阶段或分组')
      if (stage.lifecycle !== 'PENDING') throw new TrainingEngineError(409, 'TRAINING_STAGE_FROZEN', '已经开始的阶段计划不能修改')
      const key = stage.id + ':' + (groupId || 'default')
      if (seen.has(key)) throw new TrainingEngineError(422, 'TRAINING_STAGE_PLAN_DUPLICATE', '同一阶段的计划重复')
      seen.add(key)
      let plan = stage.Groups.find(item => groupId ? item.groupId === groupId : item.isDefault)
      if (!plan) {
        const created = await tx.trainingSessionStageGroup.create({ data: { stageId: stage.id, groupId, isDefault: !groupId, inheritsDefault: Boolean(groupId && raw.inheritsDefault !== false), accessPolicy: raw.accessPolicy || stage.accessPolicy, submissionMode: raw.submissionMode || stage.submissionMode, completionPolicy: asJson(raw.completionPolicy), rules: asJson(raw.rules) } })
        plan = { ...created, ProblemPlans: [] }
      } else await tx.trainingSessionStageGroup.update({ where: { id: plan.id }, data: { inheritsDefault: groupId ? raw.inheritsDefault !== false : false, accessPolicy: raw.accessPolicy || stage.accessPolicy, submissionMode: raw.submissionMode || stage.submissionMode, completionPolicy: asJson(raw.completionPolicy), rules: asJson(raw.rules) } })
      const requested = [...new Set<string>((Array.isArray(raw.problemIds) ? raw.problemIds : []).map(String))]
      const required = new Set<string>((Array.isArray(raw.requiredProblemIds) ? raw.requiredProblemIds : requested).map(String))
      const validIds = new Set(stage.Problems.map(problem => problem.id))
      if (requested.some(id => !validIds.has(id))) throw new TrainingEngineError(422, 'TRAINING_STAGE_PLAN_PROBLEM_INVALID', '计划引用了不属于当前阶段的题目')
      const previous = new Map(plan.ProblemPlans.map(problem => [problem.stageProblemId, problem]))
      await tx.trainingSessionStageProblemPlan.deleteMany({ where: { stageGroupId: plan.id } })
      for (const [orderIndex, problemId] of requested.entries()) {
        const canonical = stage.Problems.find(problem => problem.id === problemId)!
        const defaultPlan = stage.Groups.find(item => item.isDefault)
      const fallback = defaultPlan?.ProblemPlans.find(item => item.stageProblemId === problemId)
      const source = previous.get(problemId) || fallback
      if (!source) throw new TrainingEngineError(422, 'TRAINING_STAGE_PLAN_SOURCE_REQUIRED', '分组计划题目必须来自全班默认计划')
      await tx.trainingSessionStageProblemPlan.create({ data: { stageId: stage.id, stageProblemId: problemId, stageGroupId: plan.id, required: required.has(problemId), orderIndex, unlockPolicy: asJson(source.unlockPolicy), targetScore: source.targetScore, scoreGoals: asJson(source.scoreGoals), timePolicy: asJson(source.timePolicy), stuckPolicy: asJson(source.stuckPolicy), hintPolicy: asJson(source.hintPolicy), allowedSubtaskIds: asJson(source.allowedSubtaskIds), judgeConfigProjection: source.judgeConfigProjection, strategyIntervalSeconds: source.strategyIntervalSeconds, rules: asJson(raw.rules || source.rules) } })
      }
    }
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
  })
  return getTrainingDesign(userId, sessionId)
}

export async function changeTrainingGrouping(userId: string, sessionId: string, body: any) {
  return changeTrainingStageGroup(userId, sessionId, String(body?.targetStageId || ''), { ...body, effectiveMode: 'immediate' })
}

export async function splitTrainingGroup(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  if (['ENDED', 'ARCHIVED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_GROUP_SPLIT_FROZEN', '已结束训练不能拆组')
  const expectedRevision = Number(body.expectedRevision)
  const reason = boundedText(body.reason, 2000, '拆组原因', 1)
  const participantIds = [...new Set<string>((Array.isArray(body.participantIds) ? body.participantIds : []).map(String))]
  const effectiveMode = String(body.effectiveMode || 'immediate').toUpperCase()
  const requestedTargetStageId = effectiveMode === 'NEXT_STAGE' ? String(body.targetStageId || '') : null
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    if (!['IMMEDIATE', 'NEXT_STAGE'].includes(effectiveMode)) throw new TrainingEngineError(422, 'TRAINING_GROUP_CHANGE_MODE_INVALID', '拆组生效方式不受支持')
    const targetStageId = effectiveMode === 'NEXT_STAGE' ? requestedTargetStageId : current.currentStageId
    if (effectiveMode === 'IMMEDIATE' && !targetStageId) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '立即拆组只能在训练运行期间执行')
    if (effectiveMode === 'NEXT_STAGE' && !await tx.trainingSessionStage.findFirst({ where: { id: targetStageId!, sessionId, lifecycle: 'PENDING' } })) throw new TrainingEngineError(422, 'TRAINING_TARGET_STAGE_INVALID', '下一阶段拆组必须指定尚未开始的阶段')
    const source = await tx.trainingSessionGroup.findFirst({ where: { id: String(body.sourceGroupId), sessionId, status: 'active' }, include: { Participants: { where: { status: 'active' } }, StageGroups: { include: { ProblemPlans: true } } } })
    if (!source) throw new TrainingEngineError(404, 'TRAINING_GROUP_NOT_FOUND', '来源分组不存在')
    const selected = source.Participants.filter(participant => participantIds.includes(participant.id))
    if (!selected.length || selected.length !== participantIds.length || selected.length >= source.Participants.length) throw new TrainingEngineError(422, 'TRAINING_GROUP_SPLIT_PARTICIPANT_INVALID', '拆组学员必须属于来源分组且来源组至少保留一人')
    const maxOrder = await tx.trainingSessionGroup.aggregate({ where: { sessionId }, _max: { orderIndex: true } })
    const target = await tx.trainingSessionGroup.create({ data: { sessionId, name: boundedText(body.name, 100, '新分组名称', 1), orderIndex: (maxOrder._max.orderIndex ?? -1) + 1 } })
    for (const plan of source.StageGroups) {
      const copy = await tx.trainingSessionStageGroup.create({ data: { stageId: plan.stageId, groupId: target.id, isDefault: false, inheritsDefault: plan.inheritsDefault, accessPolicy: plan.accessPolicy, submissionMode: plan.submissionMode, completionPolicy: asJson(plan.completionPolicy), rules: asJson(plan.rules) } })
      for (const problem of plan.ProblemPlans) await tx.trainingSessionStageProblemPlan.create({ data: { stageId: problem.stageId, stageProblemId: problem.stageProblemId, stageGroupId: copy.id, required: problem.required, orderIndex: problem.orderIndex, unlockPolicy: asJson(problem.unlockPolicy), targetScore: problem.targetScore, scoreGoals: asJson(problem.scoreGoals), timePolicy: asJson(problem.timePolicy), stuckPolicy: asJson(problem.stuckPolicy), hintPolicy: asJson(problem.hintPolicy), allowedSubtaskIds: asJson(problem.allowedSubtaskIds), judgeConfigProjection: problem.judgeConfigProjection, strategyIntervalSeconds: problem.strategyIntervalSeconds, rules: asJson(problem.rules) } })
    }
    for (const participant of selected) {
      if (effectiveMode === 'NEXT_STAGE') {
        await tx.trainingSessionGroupChange.create({ data: { sessionId, participantId: participant.id, fromGroupId: source.id, toGroupId: target.id, reason, changedBy: userId, effectiveMode: 'NEXT_STAGE', targetStageId, status: 'pending' } })
      } else {
        await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { groupId: target.id, currentProblemId: null } })
        await tx.trainingSessionGroupChange.create({ data: { sessionId, participantId: participant.id, fromGroupId: source.id, toGroupId: target.id, reason, changedBy: userId, effectiveMode: 'IMMEDIATE', targetStageId, status: 'applied', appliedAt: new Date() } })
      }
    }
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'GROUP_SPLIT', 'GROUP', target.id, { sourceGroupId: source.id, participantCount: selected.length, effectiveMode, targetStageId, reason })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function mergeTrainingGroup(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  if (['ENDED', 'ARCHIVED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_GROUP_MERGE_FROZEN', '已结束训练不能合组')
  const expectedRevision = Number(body.expectedRevision)
  const reason = boundedText(body.reason, 2000, '合组原因', 1)
  if (String(body.sourceGroupId) === String(body.targetGroupId)) throw new TrainingEngineError(422, 'TRAINING_GROUP_MERGE_SAME_GROUP', '来源分组与目标分组不能相同')
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + sessionId)
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    const [source, target] = await Promise.all([
      tx.trainingSessionGroup.findFirst({ where: { id: String(body.sourceGroupId), sessionId, status: 'active' }, include: { Participants: { where: { status: 'active' } } } }),
      tx.trainingSessionGroup.findFirst({ where: { id: String(body.targetGroupId), sessionId, status: 'active' } }),
    ])
    if (!source || !target) throw new TrainingEngineError(404, 'TRAINING_GROUP_NOT_FOUND', '来源或目标分组不存在')
    for (const participant of source.Participants) {
      await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { groupId: target.id, currentProblemId: null } })
      await tx.trainingSessionGroupChange.create({ data: { sessionId, participantId: participant.id, fromGroupId: source.id, toGroupId: target.id, reason, changedBy: userId, effectiveMode: 'IMMEDIATE', targetStageId: current.currentStageId, status: 'applied', appliedAt: new Date() } })
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
  if (!stage || !stageProblem) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  const defaultPlan = stage.Groups.find(item => item.isDefault)
  const overridePlan = participant.groupId ? stage.Groups.find(item => item.groupId === participant.groupId) : null
  const effectivePlan = overridePlan || defaultPlan
  const overrideProblemPlan = overridePlan ? stageProblem.Plans.find(item => item.stageGroupId === overridePlan.id) : null
  const defaultProblemPlan = defaultPlan ? stageProblem.Plans.find(item => item.stageGroupId === defaultPlan.id) : null
  const plan = overrideProblemPlan || (overridePlan?.inheritsDefault === false ? null : defaultProblemPlan)
  const effectiveRule = resolveEffectiveTrainingRule({ stage, group: effectivePlan as any, plan })
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
  const slot = await prisma.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: stageProblem.problemId, slot: 'EVOLVING' } } })
    || await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: stageProblem.problemId, slot: 'STABLE' } } })
  const participant = await prisma.trainingSessionParticipant.findUniqueOrThrow({ where: { sessionId_userId: { sessionId, userId } } })
  const stage = session.Stages.find(item => item.id === stageProblem.stageId)
  const defaultPlan = stage?.Groups.find(item => item.isDefault)
  const overridePlan = participant.groupId ? stage?.Groups.find(item => item.groupId === participant.groupId) : null
  const overrideProblemPlan = overridePlan ? stageProblem.Plans.find(item => item.stageGroupId === overridePlan.id) : null
  const defaultProblemPlan = defaultPlan ? stageProblem.Plans.find(item => item.stageGroupId === defaultPlan.id) : null
  const plan = overrideProblemPlan || (overridePlan?.inheritsDefault === false ? null : defaultProblemPlan)
  const goals = Array.isArray(plan?.scoreGoals) ? plan.scoreGoals as Array<{ score: number; allowedSubtaskIds?: number[] }> : []
  const progress = await prisma.trainingSessionProblemProgress.findUnique({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } } })
  const nextGoalIndex = goals.findIndex(goal => goal.score > (progress?.bestScore || 0))
  const goalIndex = goals.length ? (nextGoalIndex < 0 ? goals.length - 1 : nextGoalIndex) : null
  const goal = goalIndex === null ? null : goals[goalIndex]
  const goalSubtasks = goal?.allowedSubtaskIds?.length ? goal.allowedSubtaskIds : []
  const planSubtasks = Array.isArray(plan?.allowedSubtaskIds) ? plan.allowedSubtaskIds.map(Number) : []
  const selectedSubtasks = goalSubtasks.length ? goalSubtasks : planSubtasks
  const baseConfig = yaml.load(slot.judgeConfig) as any
  const configText = selectedSubtasks.length
    ? yaml.dump({ ...baseConfig, subtasks: (baseConfig?.subtasks || []).filter((subtask: any) => selectedSubtasks.includes(Number(subtask.id))) }, { noRefs: true, lineWidth: 120 })
    : plan?.judgeConfigProjection || slot.judgeConfig
  const judgeConfigHash = crypto.createHash('sha256').update(configText).digest('hex')
  const goalSnapshot = goal ? { ...goal, allowedSubtaskIds: selectedSubtasks, judgeConfigHash } : null
  const config = yaml.load(configText) as any
  const io = normalizeSubmissionIo({ inputFilename: body?.inputFilename, outputFilename: body?.outputFilename, problemType: config?.type })
  return createQueuedSubmissionWithRun({ userId, workspaceScope: session.organizationId ? 'campus' : 'personal', organizationId: session.organizationId, oj: stageProblem.Problem.platform, problemId: stageProblem.Problem.problemId, language, code, codeLength: Buffer.byteLength(code, 'utf8'), submitMethod: 'local', problemInternalId: stageProblem.problemId, submitScope: 'training_engine', trainingSessionId: sessionId, trainingStageProblemId: stageProblemId, trainingScoreGoalIndex: goalIndex, trainingScoreGoalSnapshot: asJson(goalSnapshot), testSetSlot: slot.slot, testSetFencingToken: slot.fencingToken, testSetGraphHash: slot.graphHash, judgeConfigHash, judgeConfigSnapshot: configText, ...io, isGlobalVisible: true }, { requestedBy: userId })
}

export async function createTrainingHint(userId: string, sessionId: string, body: any) {
  await assertManage(userId, sessionId)
  const stageProblemId = String(body?.stageProblemId || '')
  const belongs = await prisma.trainingSessionStageProblem.findFirst({ where: { id: stageProblemId, Stage: { sessionId } }, include: { Stage: { select: { lifecycle: true } } } })
  if (!belongs) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  if (belongs.Stage.lifecycle !== 'PENDING') throw new TrainingEngineError(409, 'TRAINING_HINT_DEFINITION_FROZEN', '阶段开始后提示定义不可新增或修改，请使用运行时开放已有提示')
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
  const hint = await prisma.trainingSessionHint.findFirst({ where: { id: hintId, sessionId }, include: { StageProblem: { include: { Stage: { select: { lifecycle: true } } } } } })
  if (!hint) throw new TrainingEngineError(404, 'TRAINING_HINT_NOT_FOUND', '提示不存在')
  if (hint.StageProblem.Stage.lifecycle !== 'PENDING') throw new TrainingEngineError(409, 'TRAINING_HINT_DEFINITION_FROZEN', '阶段开始后提示定义不可修改')
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
  const hint = await prisma.trainingSessionHint.findFirst({ where: { id: hintId, sessionId }, include: { StageProblem: { include: { Stage: { select: { lifecycle: true } } } } } })
  if (!hint) throw new TrainingEngineError(404, 'TRAINING_HINT_NOT_FOUND', '提示不存在')
  if (hint.StageProblem.Stage.lifecycle !== 'PENDING') throw new TrainingEngineError(409, 'TRAINING_HINT_DEFINITION_FROZEN', '阶段开始后提示定义不可删除')
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
      const current = await tx.trainingSession.findUnique({ where: { id: item.id }, include: { Stages: { where: { lifecycle: 'PENDING' }, orderBy: { orderIndex: 'asc' }, take: 1 } } })
      if (!current || current.status !== 'SCHEDULED' || !current.Stages[0]) return
      await startGlobalStage(tx, current.id, current.Stages[0].id, null)
      await tx.trainingSession.update({ where: { id: current.id }, data: { statusRevision: { increment: 1 } } })
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
        const current = await tx.trainingSession.findUnique({ where: { id: session.id }, select: { status: true, currentStageId: true } })
        if (!current || current.status !== 'RUNNING') return
        if (current.currentStageId) {
          await applyV2StageTransition(tx, session.id, {
            action: 'end_session',
            stageId: current.currentStageId,
            outcome: 'completed',
            actorUserId: null,
            reason: '训练截止时间已到',
          })
          await tx.trainingSessionStage.update({ where: { id: current.currentStageId }, data: { endReason: 'TIME_REACHED' } })
        } else {
          await tx.trainingSessionStage.updateMany({ where: { sessionId: session.id, lifecycle: 'PENDING' }, data: { lifecycle: 'SKIPPED', endedAt: now, endReason: 'SESSION_ENDED' } })
          await tx.trainingSession.update({ where: { id: session.id }, data: { status: 'ENDED', endedAt: now, runningSince: null, statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
          await appendEvent(tx, session.id, TrainingEventTypes.SESSION_ENDED, 'ALL', null, { reason: '训练截止时间已到' })
        }
        ended++
      })
    } catch { /* another command won */ }
  }

  const timed = await prisma.trainingSession.findMany({
    where: { status: 'RUNNING', currentStageId: { not: null } },
    select: { id: true },
    take: 100,
  })
  for (const item of timed) try {
    await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) IS NULL AS locked', 'training-session:' + item.id)
      const current = await tx.trainingSession.findUnique({
        where: { id: item.id },
        include: {
          Stages: {
            orderBy: { orderIndex: 'asc' },
            include: { TimeAdjustments: { orderBy: { createdAt: 'asc' } } },
          },
        },
      })
      if (!current || current.status !== 'RUNNING' || !current.currentStageId) return
      const stage = current.Stages.find(candidate => candidate.id === current.currentStageId)
      if (!stage || stage.lifecycle !== 'RUNNING' || !['TIME', 'HYBRID'].includes(stage.endPolicy)) return
      const effectiveDurationSeconds = Number(stage.plannedDurationSeconds || 0)
        + stage.TimeAdjustments.reduce((sum, adjustment) => sum + adjustment.seconds, 0)
      const elapsedSeconds = stage.activeElapsedSeconds + stageElapsed(stage, now)
      if (effectiveDurationSeconds <= 0 || elapsedSeconds < effectiveDurationSeconds) return

      const next = current.Stages.find(candidate => candidate.orderIndex > stage.orderIndex && candidate.lifecycle === 'PENDING')
      await applyV2StageTransition(tx, current.id, {
        action: next ? 'advance' : 'end_session',
        stageId: stage.id,
        nextStageId: next?.id || null,
        outcome: 'completed',
        actorUserId: null,
        reason: '阶段计划时长已到',
      })
      await tx.trainingSessionStage.update({ where: { id: stage.id }, data: { endReason: 'TIME_REACHED' } })
      if (next) advanced++
      else ended++
    })
  } catch { /* another scheduler or command won */ }

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
  const participants = await prisma.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, include: { User: { select: { id: true, username: true, avatar: true } }, Group: true, Progress: true } })
  const now = Date.now()
  const currentStage = session.currentStageId ? session.Stages.find(stage => stage.id === session.currentStageId) || null : null
  const rows = participants.map(item => {
    const requirements = resolveParticipantSessionRequirements(session, item.id, item.Progress).filter(requirement => !currentStage || requirement.stageId === currentStage.id)
    const completedCount = requirements.filter(requirement => ['SATISFIED', 'BYPASSED'].includes(requirement.state)).length
    const currentPlan = currentStage?.Groups.find(plan => plan.groupId === item.groupId)
      || currentStage?.Groups.find(plan => plan.isDefault)
      || null
    return { id: item.id, user: item.User, currentGroupId: item.groupId, currentPlanId: currentPlan?.id || null, currentStageId: currentStage?.id || null, currentProblemId: item.currentProblemId, activeSeconds: item.activeSeconds, online: Boolean(item.lastHeartbeatAt && now - item.lastHeartbeatAt.getTime() < 90000), requiredCount: requirements.length, completedCount, completed: requirements.length > 0 && completedCount === requirements.length, working: item.Progress.some(progress => progress.status === 'WORKING'), stuck: item.Progress.some(progress => progress.status === 'STUCK'), requirements, progress: item.Progress }
  })
  return { session: { id: session.id, title: session.title, status: session.status, currentStageId: session.currentStageId, currentStage }, participants: rows, summary: { total: rows.length, working: rows.filter(item => item.working).length, stuck: rows.filter(item => item.stuck).length, completed: rows.filter(item => item.completed).length } }
}

export async function getTrainingPeerProgress(userId: string, sessionId: string) {
  const session = await assertAccess(userId, sessionId)
  const manager = await canManageSession(userId, session)
  if (trainingResultsHidden(session, manager)) return { rankingMode: 'OFF', peerVisibility: 'NONE', entries: [] }
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
  if (trainingResultsHidden(session, manager)) throw new TrainingEngineError(403, 'TRAINING_RESULTS_HIDDEN', '模拟测试结束后才能查看结果')
  const participants = await prisma.trainingSessionParticipant.findMany({
    where: manager ? { sessionId } : { sessionId, userId },
    include: { User: { select: { id: true, username: true } }, Group: true, Progress: { include: { StageProblem: { include: { Problem: { select: { title: true, problemId: true } } } } } }, ScoreEvents: { orderBy: { createdAt: 'asc' } } },
  })
  const now = new Date()
  const timeline = session.Stages.map(stage => ({
    id: stage.id,
    name: stage.name,
    orderIndex: stage.orderIndex,
    kind: stage.kind,
    lifecycle: stage.lifecycle,
    plannedDurationSeconds: stage.plannedDurationSeconds,
    actualDurationSeconds: stage.activeElapsedSeconds + (stage.lifecycle === 'RUNNING' && stage.runningSince ? Math.max(0, Math.floor((now.getTime() - stage.runningSince.getTime()) / 1000)) : 0),
    startedAt: stage.startedAt,
    endedAt: stage.endedAt,
    endReason: stage.endReason,
    plans: stage.Groups.map(plan => ({
      id: plan.id,
      groupId: plan.groupId,
      groupName: plan.TrainingGroup?.name || null,
      isDefault: plan.isDefault,
      inheritsDefault: plan.inheritsDefault,
      problemIds: plan.ProblemPlans.map(problem => problem.stageProblemId),
    })),
    timeAdjustments: stage.TimeAdjustments,
  }))
  const groupChanges = await prisma.trainingSessionGroupChange.findMany({ where: { sessionId, ...(manager ? {} : { participantId: { in: participants.map(item => item.id) } }) }, orderBy: { createdAt: 'asc' } })
  const stageIdForChange = (change: typeof groupChanges[number]) => {
    if (change.targetStageId) return change.targetStageId
    const changedAt = change.appliedAt || change.createdAt
    return session.Stages.find(stage => stage.startedAt && changedAt >= stage.startedAt && (!stage.endedAt || changedAt <= stage.endedAt))?.id || null
  }
  const appliedChanges = groupChanges.filter(change => change.status === 'applied')
  const initialGroupByParticipant = new Map(participants.map(participant => {
    let groupId = participant.groupId
    for (const change of [...appliedChanges].reverse()) {
      if (change.participantId === participant.id && change.toGroupId === groupId && change.fromGroupId) groupId = change.fromGroupId
    }
    return [participant.id, groupId] as const
  }))
  const stageGroupByParticipant = new Map(initialGroupByParticipant)
  const timelineWithGroupCompletions = timeline.map(stageReport => {
    const stage = session.Stages.find(item => item.id === stageReport.id)!
    for (const change of appliedChanges) {
      if (stageIdForChange(change) === stage.id) stageGroupByParticipant.set(change.participantId, change.toGroupId)
    }
    const groupCompletions = manager ? session.Groups.map(group => {
      const members = participants.filter(participant => stageGroupByParticipant.get(participant.id) === group.id)
      let completedParticipants = 0
      let requiredAssignments = 0
      let completedAssignments = 0
      for (const participant of members) {
        const requirements = resolveParticipantStageRequirements(stage, group.id, participant.Progress)
          .filter(requirement => requirement.state !== 'RETIRED')
        const completed = requirements.filter(requirement => ['SATISFIED', 'BYPASSED'].includes(requirement.state)).length
        requiredAssignments += requirements.length
        completedAssignments += completed
        if (requirements.length > 0 && completed === requirements.length) completedParticipants++
      }
      return { groupId: group.id, groupName: group.name, participantCount: members.length, completedParticipants, requiredAssignments, completedAssignments }
    }) : []
    return { ...stageReport, groupCompletions }
  })
  const reportParticipant = participants[0]
  const runtimeProblems = session.Overlays.filter(overlay => overlay.type === 'RUNTIME_PROBLEM' && (manager || Boolean(reportParticipant && targetApplies(
    overlay.targetType,
    overlay.targetId,
    { id: reportParticipant.id, userId: reportParticipant.userId, currentGroupId: reportParticipant.groupId },
    session,
  ))))
  const commandRecords = await prisma.trainingSessionCommand.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } })
  const interventions = commandRecords.filter(command => manager || Boolean(reportParticipant && targetApplies(
    command.targetType,
    command.targetId,
    { id: reportParticipant.id, userId: reportParticipant.userId, currentGroupId: reportParticipant.groupId },
    session,
  )))
  const rosterEvents = await prisma.trainingSessionEvent.findMany({
    where: {
      sessionId,
      type: { in: [TrainingEventTypes.PARTICIPANT_JOINED, TrainingEventTypes.PARTICIPANT_LEFT] },
      ...(manager ? {} : { targetType: 'USER', targetId: userId }),
    },
    orderBy: { createdAt: 'asc' },
  })
  return {
    session: { id: session.id, title: session.title, status: session.status, startedAt: session.startedAt, endedAt: session.endedAt },
    timeline: timelineWithGroupCompletions,
    participants: participants.map(participant => ({ id: participant.id, user: participant.User, group: participant.Group, status: participant.status, joinedAt: participant.joinedAt, activeSeconds: participant.activeSeconds, progress: participant.Progress, scoreEvents: participant.ScoreEvents })),
    groupChanges,
    rosterEvents,
    runtimeProblems,
    interventions,
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
      Stage: { select: { sessionId: true, kind: true, Groups: { select: { id: true, groupId: true, isDefault: true, inheritsDefault: true, accessPolicy: true, submissionMode: true, rules: true } } } },
      Plans: { include: { StageGroup: { select: { id: true, groupId: true, isDefault: true, inheritsDefault: true, accessPolicy: true, submissionMode: true, rules: true } } } },
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
    const defaultGroupPlan = stageProblem.Stage.Groups.find(item => item.isDefault)
    const overrideGroupPlan = participant.groupId ? stageProblem.Stage.Groups.find(item => item.groupId === participant.groupId) : null
    const defaultProblemPlan = defaultGroupPlan ? stageProblem.Plans.find(item => item.stageGroupId === defaultGroupPlan.id) : undefined
    const overrideProblemPlan = overrideGroupPlan ? stageProblem.Plans.find(item => item.stageGroupId === overrideGroupPlan.id) : undefined
    const plannedProblem = overrideProblemPlan || (overrideGroupPlan?.inheritsDefault === false ? undefined : defaultProblemPlan)
    const runtimeProblem = !plannedProblem ? await tx.trainingSessionOverlay.findFirst({ where: {
      sessionId: submission.trainingSessionId!,
      stageProblemId: submission.trainingStageProblemId!,
      type: 'RUNTIME_PROBLEM',
      status: 'active',
      OR: [
        { targetType: 'ALL' },
        { targetType: 'USER', targetId: submission.userId },
        { targetType: 'GROUP', targetId: participant.groupId },
      ],
    }, orderBy: { startedAt: 'desc' } }) : null
    const runtimeRule = runtimeProblem ? parseJsonObject(runtimeProblem.payload) : undefined
    const plan = plannedProblem || runtimeRule
    const effectiveRule = resolveEffectiveTrainingRule({ stage: stageProblem.Stage, group: overrideGroupPlan || defaultGroupPlan || null, plan, runtimeOverride: runtimeRule ? { ...runtimeRule, problemAccessPolicy: 'ALL_AT_ONCE' } : undefined })
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
