import crypto from 'node:crypto'
import yaml from 'js-yaml'
import type { Prisma, TrainingEngineSessionStatus, TrainingEngineTargetType } from '@prisma/client'
import { prisma } from '../../prisma'
import { isOrganizationContestAdmin, isOrganizationMember, isTeamAdmin, isTeamMember } from '../training/training.helpers'
import { createQueuedSubmissionWithRun } from '../judge/application/judge-run.service'
import { normalizeSubmissionIo } from '../judge/domain/submission-io'
import { BUILTIN_TRAINING_TEMPLATES, getBuiltinTrainingTemplate } from './training-engine.templates'
import { TrainingEngineError } from './training-engine.errors'
import { eligibleTrainingParticipantIds, validateTrainingParticipantTarget } from './application/training-roster.service'
import { trainingMetrics } from './training-metrics'
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
  audienceMode?: string
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
  groups?: Array<{
    id?: string
    clientKey?: string
    name: string
    accessPolicy?: string
    submissionMode?: string
    rules?: unknown
    participantIds?: string[]
    problems?: StructureStage['problems']
  }>
}

const COMMANDS = new Set([
  'PAUSE_SESSION', 'RESUME_SESSION',
  'FOCUS_PROBLEM', 'END_FOCUS', 'LOCK_PROBLEM', 'UNLOCK_PROBLEM', 'ENABLE_SUBMISSION', 'DISABLE_SUBMISSION',
  'OPEN_HINT', 'CLOSE_HINT', 'UNLOCK_FOR_USER', 'SKIP_FOR_USER', 'SHOW_MESSAGE', 'CLEAR_MESSAGE',
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
  SHOW_MESSAGE: new Set(['RUNNING', 'PAUSED']),
  CLEAR_MESSAGE: new Set(['RUNNING', 'PAUSED']),
}

function assertTrainingCommandAllowed(type: string, status: string) {
  const allowed = COMMAND_ALLOWED_SESSION_STATUS[type]
  if (!allowed?.has(status)) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', `训练状态 ${status} 不允许执行 ${type}`)
}
const SESSION_TYPES = new Set(['OI', 'ACM', 'GENERAL'])
const STAGE_KINDS = new Set(['TRAINING', 'TEACHING', 'REVIEW'])
const AUDIENCE_MODES = new Set(['ALL', 'GROUPED'])
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
      Groups: { orderBy: { orderIndex: 'asc' }, include: { ProblemPlans: { orderBy: { orderIndex: 'asc' } }, Assignments: { include: { Participant: { select: { userId: true } } } } } },
      ParticipantAssignments: { include: { Participant: { select: { userId: true } } } },
      RuntimeSnapshot: true,
      TimeAdjustments: { orderBy: { createdAt: 'asc' } },
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
      const groups = Array.isArray(storedRules._templateGroups) ? storedRules._templateGroups : undefined
      const stageSettings = parseJsonObject(storedRules._templateStage)
      const { _templateGroups: _discarded, _templateStage: _discardedStage, ...rules } = storedRules
      return {
        name: stage.name,
        description: stage.description || '',
        kind: stage.kind,
        audienceMode: stage.audienceMode,
        ...(stage.plannedDurationSeconds ? { plannedDurationSeconds: stage.plannedDurationSeconds } : {}),
        endPolicy: stage.endPolicy,
        accessPolicy: stage.accessPolicy,
        accessScope: normalizeTrainingAccessScope(rules.accessScope),
        submissionMode: stage.submissionMode,
        ...(stageSettings.defaultTargetScore != null ? { defaultTargetScore: stageSettings.defaultTargetScore } : {}),
        ...(stageSettings.completionThreshold != null ? { completionThreshold: stageSettings.completionThreshold } : {}),
        ...(stageSettings.minDurationSeconds != null ? { minDurationSeconds: stageSettings.minDurationSeconds } : {}),
        ...(Object.keys(rules).length ? { rules } : {}),
        ...(groups ? { groups } : {}),
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
      Stages: { create: session.Stages.map((stage, orderIndex) => ({
        name: stage.name, description: stage.description, orderIndex, kind: stage.kind,
        audienceMode: stage.audienceMode, plannedDurationSeconds: stage.plannedDurationSeconds,
        endPolicy: stage.endPolicy, accessPolicy: stage.accessPolicy, submissionMode: stage.submissionMode,
        rules: asJson({
          ...parseJsonObject(stage.rules),
          _templateStage: { defaultTargetScore: stage.defaultTargetScore, completionThreshold: stage.completionThreshold, minDurationSeconds: stage.minDurationSeconds },
          ...(stage.audienceMode === 'GROUPED' ? { _templateGroups: stage.Groups.map((group, groupIndex) => ({ clientKey: `group-${groupIndex + 1}`, name: group.name, accessPolicy: group.accessPolicy, submissionMode: group.submissionMode, rules: parseJsonObject(group.rules) })) } : {}),
        }),
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
  const stageProblemInputs = (stage: StructureStage) => [
    ...(stage.problems || []),
    ...(stage.groups || []).flatMap(group => group.problems || []),
  ]
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
    const audienceMode = enumValue(stage.audienceMode, AUDIENCE_MODES, 'ALL', `阶段 ${stageIndex + 1} 学员组织方式`)
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
    const groups = (stage.groups || []).map((group, groupIndex) => {
      const groupName = boundedText(group.name, 100, `阶段 ${stageIndex + 1} 第 ${groupIndex + 1} 个分组名称`, 1)
      const groupAccessPolicy = enumValue(group.accessPolicy, ACCESS_POLICIES, accessPolicy, `${groupName}题目开放方式`)
      const groupSubmissionMode = enumValue(group.submissionMode, SUBMISSION_MODES, submissionMode, `${groupName}提交方式`)
      const seen = new Set<string>()
      const problems = (group.problems || []).map((item, index) => {
        const normalized = normalizeProblem(item, index, `阶段 ${stageIndex + 1}「${groupName}」`)
        if (seen.has(normalized.problem.id)) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', `分组「${groupName}」重复引用同一道题`)
        seen.add(normalized.problem.id)
        return normalized
      })
      const groupRules = parseJsonObject(group.rules)
      return { group: { ...group, name: groupName, accessPolicy: groupAccessPolicy, submissionMode: groupSubmissionMode, rules: { ...groupRules, ...(groupRules.timePolicy ? { timePolicy: normalizeProblemTimePolicy(groupRules.timePolicy) } : {}), ...(groupRules.stuckPolicy ? { stuckPolicy: normalizeStuckPolicy(groupRules.stuckPolicy) } : {}) } }, groupIndex, problems }
    })
    if (audienceMode === 'GROUPED' && groups.length < 1) throw new TrainingEngineError(422, 'TRAINING_STAGE_GROUP_REQUIRED', `阶段 ${stageIndex + 1} 使用分组训练时至少需要一个分组`)
    if (audienceMode === 'ALL' && groups.length) throw new TrainingEngineError(422, 'TRAINING_STAGE_GROUP_UNEXPECTED', `阶段 ${stageIndex + 1} 为全班统一训练，不能保存分组`)
    const allSeen = new Set<string>()
    const stageProblems = (stage.problems || []).map((item, problemIndex) => {
      const normalized = normalizeProblem(item, problemIndex, `阶段 ${stageIndex + 1}`)
      if (allSeen.has(normalized.problem.id)) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', `阶段 ${stageIndex + 1} 重复引用同一道题`)
      allSeen.add(normalized.problem.id)
      return normalized
    })
    if (audienceMode === 'GROUPED' && stageProblems.length) throw new TrainingEngineError(422, 'TRAINING_STAGE_ALL_PROBLEMS_UNEXPECTED', `阶段 ${stageIndex + 1} 使用分组训练时，题目必须配置在具体分组中`)
    if (rules.requiredProblemCount !== undefined) {
      const maximum = audienceMode === 'ALL' ? stageProblems.length : Math.max(0, ...groups.map(group => group.problems.length))
      rules.requiredProblemCount = boundedInteger(rules.requiredProblemCount, 1, Math.max(1, maximum), '阶段至少完成题数', false)
    }
    return { stage: { ...stage, kind, audienceMode, endPolicy, accessPolicy, accessScope, submissionMode, plannedDurationSeconds, completionThreshold, rules }, stageIndex, name, stageProblems, groups }
  })
}

async function createStageGraph(tx: Prisma.TransactionClient, sessionId: string, entry: any, participantByUserId = new Map<string, string>()) {
  const stage = await tx.trainingSessionStage.create({ data: {
    sessionId,
    name: entry.name,
    description: entry.stage.description?.trim() || null,
    orderIndex: entry.stageIndex,
    kind: entry.stage.kind,
    audienceMode: entry.stage.audienceMode,
    lifecycle: 'PENDING',
    endPolicy: entry.stage.endPolicy,
    accessPolicy: entry.stage.accessPolicy,
    submissionMode: entry.stage.submissionMode,
    plannedDurationSeconds: entry.stage.plannedDurationSeconds,
    defaultTargetScore: boundedInteger(entry.stage.defaultTargetScore, 0, 100, '默认目标分数'),
    completionThreshold: entry.stage.completionThreshold,
    minDurationSeconds: boundedInteger(entry.stage.minDurationSeconds, 0, 86400, '最短阶段时长'),
    rules: asJson(entry.stage.rules),
  } })
  const stageProblemByProblemId = new Map<string, string>()
  const ensureStageProblem = async (item: any) => {
    const existing = stageProblemByProblemId.get(item.problem.id)
    if (existing) return existing
    const saved = await tx.trainingSessionStageProblem.create({ data: {
      stageId: stage.id,
      problemId: item.problem.id,
      testSetRevisionId: item.revision.id,
      alias: item.item.alias?.trim() || null,
      orderIndex: stageProblemByProblemId.size,
      titleSnapshot: item.problem.title,
      statementsSnapshot: asJson(item.problem.ProblemStatement.map((statement: any) => ({ type: statement.type, format: statement.format, language: statement.language, content: statement.content, fileUrl: statement.fileUrl }))),
      unlockPolicy: asJson(item.item.unlockPolicy),
      targetScore: boundedInteger(item.item.targetScore, 0, 100, '题目目标分数'),
      scoreGoals: asJson(item.item.scoreGoals),
      timePolicy: asJson(item.item.timePolicy),
      stuckPolicy: asJson(item.item.stuckPolicy),
      hintPolicy: asJson(item.item.hintPolicy),
      judgeConfigProjection: item.projection,
      allowedSubtaskIds: item.allowedSubtaskIds.length ? item.allowedSubtaskIds : undefined,
      strategyIntervalSeconds: boundedInteger(item.item.strategyIntervalSeconds, 60, 86400, '策略检查间隔'),
    } })
    stageProblemByProblemId.set(item.problem.id, saved.id)
    return saved.id
  }
  const savePlan = async (item: any, orderIndex: number, groupId: string | null) => {
    const stageProblemId = await ensureStageProblem(item)
    await tx.trainingSessionStageProblemPlan.create({ data: {
      stageId: stage.id,
      stageProblemId,
      groupId,
      orderIndex,
      unlockPolicy: asJson(item.item.unlockPolicy),
      targetScore: boundedInteger(item.item.targetScore, 0, 100, '题目目标分数'),
      scoreGoals: asJson(item.item.scoreGoals),
      timePolicy: asJson(item.item.timePolicy),
      stuckPolicy: asJson(item.item.stuckPolicy),
      hintPolicy: asJson(item.item.hintPolicy),
      allowedSubtaskIds: item.allowedSubtaskIds.length ? item.allowedSubtaskIds : undefined,
      judgeConfigProjection: item.projection,
      strategyIntervalSeconds: boundedInteger(item.item.strategyIntervalSeconds, 60, 86400, '策略检查间隔'),
    } })
  }
  if (entry.stage.audienceMode === 'ALL') {
    for (const [index, item] of entry.stageProblems.entries()) await savePlan(item, index, null)
    for (const participantId of participantByUserId.values()) await tx.trainingSessionStageParticipantAssignment.create({ data: { stageId: stage.id, participantId, source: 'creation' } })
  } else {
    for (const groupEntry of entry.groups) {
      const group = await tx.trainingSessionStageGroup.create({ data: { stageId: stage.id, name: groupEntry.group.name, orderIndex: groupEntry.groupIndex, accessPolicy: groupEntry.group.accessPolicy, submissionMode: groupEntry.group.submissionMode, rules: asJson(groupEntry.group.rules) } })
      for (const [index, item] of groupEntry.problems.entries()) await savePlan(item, index, group.id)
      for (const userId of groupEntry.group.participantIds || []) {
        const participantId = participantByUserId.get(String(userId))
        if (participantId) await tx.trainingSessionStageParticipantAssignment.create({ data: { stageId: stage.id, participantId, groupId: group.id, source: 'creation' } })
      }
    }
    for (const participantId of participantByUserId.values()) await tx.trainingSessionStageParticipantAssignment.upsert({ where: { stageId_participantId: { stageId: stage.id, participantId } }, create: { stageId: stage.id, participantId, source: 'creation' }, update: {} })
  }
  return stage
}


export async function createTrainingSession(userId: string, body: any) {
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
  const rawStages = Array.isArray(body?.stages) && body.stages.length ? body.stages : template?.stages || [{ name: '训练', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', problems: [] }]
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
      sessionType: sessionType as any, ...scope, createdBy: userId,
      scheduledStartAt,
      defaultAccessPolicy: defaultAccessPolicy as any, defaultSubmissionMode: defaultSubmissionMode as any,
      allowHints: body?.allowHints !== false,
      rankingMode: rankingMode as any, peerVisibility: peerVisibility as any, joinMode: joinMode as any,
      settings: asJson(requestedParticipantIds.length ? { ...settings, rosterExplicit: true } : settings),
    } })
    const participantByUserId = new Map<string, string>()
    for (const participantUserId of requestedParticipantIds) {
      const participant = await tx.trainingSessionParticipant.create({ data: { sessionId: id, userId: participantUserId } })
      participantByUserId.set(participantUserId, participant.id)
    }
    for (const entry of hydrated) await createStageGraph(tx, id, entry, participantByUserId)
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
    const plans = stage.audienceMode === 'GROUPED' ? (stage.groups || []).flatMap(group => group.problems || []) : stage.problems || []
    if (String(stage.kind || 'TRAINING') === 'TRAINING' && plans.length === 0) {
      issues.push({ path: `stages.${stageIndex}.problems`, code: 'STAGE_PROBLEM_REQUIRED', message: `阶段 ${stageIndex + 1} 至少需要一道题`, severity: 'error' })
    }
    const checkSequential = (problems: NonNullable<StructureStage['problems']>, path: string, policy: string | undefined) => {
      if (policy !== 'SEQUENTIAL') return
      problems.slice(1).forEach((problem, problemIndex) => {
        const fallback = parseJsonObject(stage.rules).defaultUnlock
        if (!problem.unlockPolicy && !fallback) issues.push({ path: `${path}.${problemIndex + 1}.unlockPolicy`, code: 'UNLOCK_POLICY_REQUIRED', message: `阶段 ${stageIndex + 1} 的第 ${problemIndex + 2} 道题需要解锁条件`, severity: 'error' })
      })
    }
    if (stage.audienceMode === 'GROUPED') (stage.groups || []).forEach((group, groupIndex) => checkSequential(group.problems || [], `stages.${stageIndex}.groups.${groupIndex}.problems`, group.accessPolicy || stage.accessPolicy))
    else checkSequential(stage.problems || [], `stages.${stageIndex}.problems`, stage.accessPolicy)
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
    problemIds.length ? prisma.problem.findMany({ where: { id: { in: problemIds } }, select: { id: true, latestTestSetRevisionId: true, LatestTestSetRevision: { select: { id: true, revisionNumber: true } } } }) : [],
    revisionIds.length ? prisma.problemTestSetRevisionSubtask.findMany({ where: { revisionId: { in: revisionIds } }, orderBy: [{ revisionId: 'asc' }, { orderIndex: 'asc' }], select: { revisionId: true, subtaskId: true, score: true, Dependencies: { select: { DependsOn: { select: { subtaskId: true } } } } } }) : [],
  ])
  const latestByProblem = new Map(latest.map(item => [item.id, item.LatestTestSetRevision]))
  const subtasksByRevision = new Map<string, Array<{ id: number; score: number; dependencies: number[] }>>()
  for (const item of subtasks) subtasksByRevision.set(item.revisionId, [...(subtasksByRevision.get(item.revisionId) || []), { id: item.subtaskId, score: item.score, dependencies: item.Dependencies.map(dependency => dependency.DependsOn.subtaskId) }])
  const stages = session.Stages.map((stage, stageIndex) => {
    const decorate = (plan: typeof stage.Problems[number]['Plans'][number]) => {
      const problem = stage.Problems.find(item => item.id === plan.stageProblemId)!
      return {
        ...problem,
        ...plan,
        id: problem.id,
        planId: plan.id,
        assignmentId: problem.id,
        clientKey: plan.id,
        latestRevision: latestByProblem.get(problem.problemId) || null,
        subtasks: subtasksByRevision.get(problem.testSetRevisionId) || [],
      }
    }
    const allPlans = stage.Problems.flatMap(problem => problem.Plans).filter(plan => plan.groupId === null).sort((a, b) => a.orderIndex - b.orderIndex)
    return {
      ...stage,
      clientKey: stage.id,
      orderIndex: stageIndex,
      Problems: allPlans.map(decorate),
      Groups: stage.Groups.map(group => ({
        id: group.id,
        clientKey: group.id,
        name: group.name,
        orderIndex: group.orderIndex,
        accessPolicy: group.accessPolicy,
        submissionMode: group.submissionMode,
        rules: group.rules,
        participantIds: group.Assignments.map(item => item.Participant.userId),
        Problems: group.ProblemPlans.map(decorate),
      })),
      accessScope: normalizeTrainingAccessScope(parseJsonObject(stage.rules).accessScope),
      effectiveDurationSeconds: (stage.plannedDurationSeconds || 0) + stage.TimeAdjustments.reduce((sum, item) => sum + item.seconds, 0),
    }
  })
  const payloadStages = stages.map(stage => ({ ...stage, problems: stage.Problems, groups: stage.Groups.map(group => ({ ...group, problems: group.Problems })) })) as unknown as StructureStage[]
  return { editable: !['ENDED', 'ARCHIVED'].includes(session.status), statusRevision: session.statusRevision, session: { id: session.id, title: session.title, description: session.description, sessionType: session.sessionType, status: session.status, organizationId: session.organizationId, teamId: session.teamId, scheduledStartAt: session.scheduledStartAt, rankingMode: session.rankingMode, peerVisibility: session.peerVisibility, joinMode: session.joinMode, allowHints: session.allowHints }, stages, issues: structureIssues(payloadStages) }
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
  const session = await assertManage(userId, sessionId)
  if (['ENDED', 'ARCHIVED'].includes(session.status)) throw new TrainingEngineError(409, 'TRAINING_STRUCTURE_FROZEN', '已结束训练的结构不能修改')
  const expectedRevision = Number(body?.expectedRevision)
  if (expectedRevision !== session.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练已被其他管理员修改，请刷新')
  const stages = Array.isArray(body?.stages) ? body.stages as StructureStage[] : []
  const issues = structureIssues(stages)
  if (issues.some(issue => issue.severity === 'error')) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', issues.map(issue => issue.message).join('；'), { issues })
  const requestedStageIds = stages.map(stage => stage.id).filter((id): id is string => Boolean(id))
  if (new Set(requestedStageIds).size !== requestedStageIds.length) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', '阶段 ID 重复')
  const hydrated = await hydrateStages(stages, await problemAccessContext(userId, session.organizationId, session.teamId))
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
    const claimed = await tx.trainingSession.updateMany({ where: { id: sessionId, statusRevision: expectedRevision, status: session.status }, data: { statusRevision: { increment: 1 }, title: body?.title ? boundedText(body.title, 200, '训练名称', 1) : session.title, description: body?.description === undefined ? session.description : body.description ? boundedText(body.description, 5000, '训练说明') : null } })
    if (!claimed.count) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练已被其他管理员修改，请刷新')
    const existingStages = await tx.trainingSessionStage.findMany({ where: { sessionId }, include: { Problems: { include: { _count: { select: { Hints: true } } } }, RuntimeSnapshot: true, _count: { select: { ParticipantAssignments: true, Groups: true, ProblemPlans: true } } } })
    const stageById = new Map(existingStages.map(stage => [stage.id, stage]))
    for (const stage of stages) if (stage.id && !stageById.has(stage.id)) throw new TrainingEngineError(422, 'TRAINING_STAGE_NOT_FOUND', '阶段不属于当前训练')
    const frozenStages = existingStages.filter(stage => stage.lifecycle !== 'PENDING' || stage.RuntimeSnapshot)
    const requested = new Set(requestedStageIds)
    const missingFrozen = frozenStages.filter(stage => !requested.has(stage.id))
    if (missingFrozen.length) throw new TrainingEngineError(409, 'TRAINING_STAGE_FROZEN', '运行中或已结束的 Stage 必须保留，不能删除或回滚')
    const removedPending = existingStages.filter(stage => stage.lifecycle === 'PENDING' && !requested.has(stage.id))
    const removalImpact = removedPending.map(stage => ({
      stageId: stage.id,
      name: stage.name,
      hintCount: stage.Problems.reduce((sum, problem) => sum + problem._count.Hints, 0),
      participantAssignmentCount: stage._count.ParticipantAssignments,
      groupCount: stage._count.Groups,
      problemPlanCount: stage._count.ProblemPlans,
    })).filter(item => item.hintCount || item.participantAssignmentCount || item.groupCount || item.problemPlanCount)
    if (removalImpact.length && body?.confirmDependentRemoval !== true) {
      throw new TrainingEngineError(409, 'TRAINING_STRUCTURE_REMOVAL_REQUIRES_CONFIRMATION', `删除未来 Stage 将同时移除 ${removalImpact.reduce((sum, item) => sum + item.hintCount, 0)} 条提示、${removalImpact.reduce((sum, item) => sum + item.participantAssignmentCount, 0)} 条预分组和 ${removalImpact.reduce((sum, item) => sum + item.problemPlanCount, 0)} 条题目要求，请确认后重试`, { stages: removalImpact })
    }
    await tx.trainingSessionStage.updateMany({ where: { sessionId, lifecycle: 'PENDING' }, data: { orderIndex: { increment: 10000 } } })
    const keepStageIds: string[] = []
    for (const entry of hydrated) {
      const requestedStageId = entry.stage.id && stageById.has(entry.stage.id) ? entry.stage.id : null
      const existing = requestedStageId ? stageById.get(requestedStageId)! : null
      if (existing && (existing.lifecycle !== 'PENDING' || existing.RuntimeSnapshot)) {
        if (existing.orderIndex !== entry.stageIndex) throw new TrainingEngineError(409, 'TRAINING_STAGE_FROZEN', `Stage「${existing.name}」已经开始，不能重新排序`)
        keepStageIds.push(existing.id)
        continue
      }
      const data = { name: entry.name, description: entry.stage.description?.trim() || null, orderIndex: entry.stageIndex, kind: entry.stage.kind as any, audienceMode: entry.stage.audienceMode as any, endPolicy: entry.stage.endPolicy as any, accessPolicy: entry.stage.accessPolicy as any, submissionMode: entry.stage.submissionMode as any, plannedDurationSeconds: entry.stage.plannedDurationSeconds, defaultTargetScore: boundedInteger(entry.stage.defaultTargetScore, 0, 100, '默认目标分数'), completionThreshold: entry.stage.completionThreshold, minDurationSeconds: boundedInteger(entry.stage.minDurationSeconds, 0, 86400, '最短阶段时长'), rules: asJson(entry.stage.rules), definitionRevision: { increment: 1 } }
      const savedStage = existing
        ? await tx.trainingSessionStage.update({ where: { id: existing.id }, data })
        : await tx.trainingSessionStage.create({ data: { sessionId, ...data, definitionRevision: 0 } })
      keepStageIds.push(savedStage.id)
      const oldProblems = existing ? await tx.trainingSessionStageProblem.findMany({ where: { stageId: savedStage.id }, include: { _count: { select: { Hints: true } } } }) : []
      const oldByProblemId = new Map(oldProblems.map(problem => [problem.problemId, problem]))
      const allEntries = entry.stage.audienceMode === 'ALL' ? entry.stageProblems : entry.groups.flatMap((group: any) => group.problems)
      const neededProblemIds = new Set(allEntries.map((item: any) => item.problem.id))
      const removedWithHints = oldProblems.filter(problem => !neededProblemIds.has(problem.problemId) && problem._count.Hints > 0)
      if (removedWithHints.length && body?.confirmDependentRemoval !== true) throw new TrainingEngineError(409, 'TRAINING_STRUCTURE_REMOVAL_REQUIRES_CONFIRMATION', `将删除 ${removedWithHints.reduce((sum, item) => sum + item._count.Hints, 0)} 条关联提示，请确认后重试`)
      await tx.trainingSessionStageParticipantAssignment.deleteMany({ where: { stageId: savedStage.id } })
      await tx.trainingSessionStageProblemPlan.deleteMany({ where: { stageId: savedStage.id } })
      await tx.trainingSessionStageGroup.deleteMany({ where: { stageId: savedStage.id } })
      const canonicalByProblemId = new Map<string, string>()
      for (const item of allEntries) {
        if (canonicalByProblemId.has(item.problem.id)) continue
        const problemData = { problemId: item.problem.id, testSetRevisionId: item.revision.id, alias: item.item.alias?.trim() || null, orderIndex: canonicalByProblemId.size, titleSnapshot: item.problem.title, statementsSnapshot: asJson(item.problem.ProblemStatement.map((statement: any) => ({ type: statement.type, format: statement.format, language: statement.language, content: statement.content, fileUrl: statement.fileUrl }))), unlockPolicy: asJson(item.item.unlockPolicy), targetScore: boundedInteger(item.item.targetScore, 0, 100, '题目目标分数'), scoreGoals: asJson(item.item.scoreGoals), timePolicy: asJson(item.item.timePolicy), stuckPolicy: asJson(item.item.stuckPolicy), hintPolicy: asJson(item.item.hintPolicy), judgeConfigProjection: item.projection, allowedSubtaskIds: item.allowedSubtaskIds.length ? item.allowedSubtaskIds : undefined, strategyIntervalSeconds: boundedInteger(item.item.strategyIntervalSeconds, 60, 86400, '策略检查间隔') }
        const old = oldByProblemId.get(item.problem.id)
        const saved = old ? await tx.trainingSessionStageProblem.update({ where: { id: old.id }, data: problemData }) : await tx.trainingSessionStageProblem.create({ data: { stageId: savedStage.id, ...problemData } })
        canonicalByProblemId.set(item.problem.id, saved.id)
      }
      await tx.trainingSessionStageProblem.deleteMany({ where: { stageId: savedStage.id, problemId: { notIn: [...neededProblemIds] } } })
      const participants = await tx.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, select: { id: true, userId: true } })
      const savePlan = (item: any, orderIndex: number, groupId: string | null) => tx.trainingSessionStageProblemPlan.create({ data: { stageId: savedStage.id, stageProblemId: canonicalByProblemId.get(item.problem.id)!, groupId, orderIndex, unlockPolicy: asJson(item.item.unlockPolicy), targetScore: boundedInteger(item.item.targetScore, 0, 100, '题目目标分数'), scoreGoals: asJson(item.item.scoreGoals), timePolicy: asJson(item.item.timePolicy), stuckPolicy: asJson(item.item.stuckPolicy), hintPolicy: asJson(item.item.hintPolicy), allowedSubtaskIds: item.allowedSubtaskIds.length ? item.allowedSubtaskIds : undefined, judgeConfigProjection: item.projection, strategyIntervalSeconds: boundedInteger(item.item.strategyIntervalSeconds, 60, 86400, '策略检查间隔') } })
      if (entry.stage.audienceMode === 'ALL') {
        for (const [index, item] of entry.stageProblems.entries()) await savePlan(item, index, null)
        for (const participant of participants) await tx.trainingSessionStageParticipantAssignment.create({ data: { stageId: savedStage.id, participantId: participant.id, assignedBy: userId, source: 'structure' } })
      } else {
        const assignedParticipants = new Set<string>()
        for (const groupEntry of entry.groups) {
          const group = await tx.trainingSessionStageGroup.create({ data: { stageId: savedStage.id, name: groupEntry.group.name, orderIndex: groupEntry.groupIndex, accessPolicy: groupEntry.group.accessPolicy as any, submissionMode: groupEntry.group.submissionMode as any, rules: asJson(groupEntry.group.rules) } })
          for (const [index, item] of groupEntry.problems.entries()) await savePlan(item, index, group.id)
          for (const participant of participants.filter(item => (groupEntry.group.participantIds || []).includes(item.userId))) {
            await tx.trainingSessionStageParticipantAssignment.create({ data: { stageId: savedStage.id, participantId: participant.id, groupId: group.id, assignedBy: userId, source: 'structure' } })
            assignedParticipants.add(participant.id)
          }
        }
        for (const participant of participants.filter(item => !assignedParticipants.has(item.id))) await tx.trainingSessionStageParticipantAssignment.create({ data: { stageId: savedStage.id, participantId: participant.id, assignedBy: userId, source: 'structure' } })
      }
    }
    await tx.trainingSessionStage.deleteMany({ where: { sessionId, lifecycle: 'PENDING', id: { notIn: keepStageIds } } })
  })
  return loadSession(sessionId)
}

async function appendEvent(tx: Prisma.TransactionClient, sessionId: string, type: string, targetType: TrainingEngineTargetType = 'ALL', targetId: string | null = null, payload?: unknown) {
  const session = await tx.trainingSession.update({ where: { id: sessionId }, data: { eventSeq: { increment: 1 } }, select: { eventSeq: true } })
  return tx.trainingSessionEvent.create({ data: { sessionId, seq: session.eventSeq, type, targetType, targetId, payload: asJson(payload), expiresAt: new Date(Date.now() + 7 * 24 * 3600_000) } })
}

export async function publishTrainingSession(userId: string, sessionId: string, expectedRevision: number) {
  const session = await assertManage(userId, sessionId)
  if (session.status !== 'DRAFT') throw new TrainingEngineError(409, 'TRAINING_SESSION_ALREADY_PUBLISHED', '训练已经发布')
  if (!session.Stages.length || session.Stages.some(stage => !stage.Problems.length && stage.kind === 'TRAINING')) throw new TrainingEngineError(422, 'TRAINING_STRUCTURE_INCOMPLETE', '训练阶段必须至少包含一道题')
  const issues = structureIssues(session.Stages.map(stage => ({ ...stage, problems: stage.Problems, groups: stage.Groups.map(group => ({ ...group, problems: group.ProblemPlans.map(plan => stage.Problems.find(problem => problem.id === plan.stageProblemId)!) })) })) as unknown as StructureStage[])
  if (issues.some(issue => issue.severity === 'error')) throw new TrainingEngineError(422, 'TRAINING_STRUCTURE_INCOMPLETE', issues.map(issue => issue.message).join('；'))
  const assigned = await prisma.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, select: { userId: true } })
  const userIds = assigned.length ? assigned.map(item => item.userId) : await eligibleTrainingParticipantIds(session)
  await prisma.$transaction(async tx => {
    const claimed = await tx.trainingSession.updateMany({ where: { id: sessionId, status: 'DRAFT', statusRevision: expectedRevision }, data: { status: 'SCHEDULED', statusRevision: { increment: 1 }, currentStageId: session.Stages[0].id } })
    if (!claimed.count) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练已被其他管理员修改，请刷新')
    for (const participantUserId of [...new Set(userIds)]) {
      const participant = await tx.trainingSessionParticipant.upsert({ where: { sessionId_userId: { sessionId, userId: participantUserId } }, update: { status: 'active', currentStageId: session.Stages[0].id }, create: { sessionId, userId: participantUserId, currentStageId: session.Stages[0].id } })
      for (const stage of session.Stages) await tx.trainingSessionStageParticipantAssignment.upsert({ where: { stageId_participantId: { stageId: stage.id, participantId: participant.id } }, update: {}, create: { stageId: stage.id, participantId: participant.id, assignedBy: userId, source: 'publish' } })
    }
    await appendEvent(tx, sessionId, 'training.session.scheduled', 'ALL', null, { scheduledStartAt: session.scheduledStartAt })
  })
  return loadSession(sessionId)
}

function targetApplies(targetType: TrainingEngineTargetType, targetId: string | null, participant: { id?: string; userId: string; currentGroupId?: string | null }, session: { teamId: string | null; currentStageId?: string | null; Stages?: Array<{ id: string; ParticipantAssignments?: Array<{ participantId: string; groupId: string | null }> }> }) {
  if (targetType === 'ALL') return true
  if (targetType === 'USER') return targetId === participant.userId
  if (targetType === 'GROUP') {
    const assignment = session.Stages?.find(stage => stage.id === session.currentStageId)?.ParticipantAssignments?.find(item => item.participantId === participant.id)
    return targetId === (participant.currentGroupId ?? assignment?.groupId ?? null)
  }
  if (targetType === 'TEAM') return targetId === session.teamId
  return false
}

async function normalizeCommandTarget(
  tx: Prisma.TransactionClient,
  session: { id: string; teamId: string | null; currentStageId?: string | null },
  targetType: TrainingEngineTargetType,
  rawTargetId: string | null,
) {
  if (targetType === 'ALL') return null
  if (targetType === 'TEAM') {
    if (!session.teamId || rawTargetId && rawTargetId !== session.teamId) throw new TrainingEngineError(422, 'INVALID_TRAINING_COMMAND_TARGET', '当前训练不属于指定团队')
    return session.teamId
  }
  if (!rawTargetId) throw new TrainingEngineError(422, 'TRAINING_COMMAND_TARGET_REQUIRED', '该教练命令必须指定目标')
  if (targetType === 'GROUP') {
    const group = await tx.trainingSessionStageGroup.findFirst({ where: { id: rawTargetId, Stage: { sessionId: session.id, ...(session.currentStageId ? { id: session.currentStageId } : {}) } }, select: { id: true } })
    if (!group) throw new TrainingEngineError(422, 'TRAINING_GROUP_NOT_FOUND', '训练分组不存在')
    return group.id
  }
  const participant = await tx.trainingSessionParticipant.findFirst({ where: { sessionId: session.id, userId: rawTargetId, status: 'active' }, select: { userId: true } })
  if (!participant) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_NOT_FOUND', '学员不在当前训练')
  return participant.userId
}

function sameOverlayTarget(targetType: TrainingEngineTargetType, targetId: string | null) {
  return { targetType, targetId } as const
}

async function restoreFocusParticipants(
  tx: Prisma.TransactionClient,
  session: { id: string; teamId: string | null },
  participants: Array<{ id: string; userId: string; returnStageId: string | null; returnProblemId: string | null }>,
) {
  const remaining = await tx.trainingSessionOverlay.findMany({
    where: { sessionId: session.id, status: 'active', type: { in: ['SOFT_FOCUS', 'LOCKED_FOCUS', 'EXAM_FOCUS'] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { startedAt: 'asc' },
  })
  for (const participant of participants) {
    const activeFocus = [...remaining].reverse().find(overlay => targetApplies(overlay.targetType, overlay.targetId, participant, session))
    if (activeFocus?.stageProblemId) {
      await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { currentProblemId: activeFocus.stageProblemId } })
      continue
    }
    await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: {
      currentStageId: participant.returnStageId,
      currentProblemId: participant.returnProblemId,
      returnStageId: null,
      returnProblemId: null,
    } })
  }
}

function conditionSatisfied(condition: any, progress: any) {
  // Teacher SKIP is an explicit bypass of the prerequisite, regardless of
  // whether the original gate was AC / SCORE / TIME / ATTEMPTS.
  if (progress?.status === 'SKIPPED') return true
  if (condition?.type === 'TEACHER') return false
  if (condition?.type === 'AC') return Boolean(progress?.acAt) || String(progress?.bestVerdict || '').toLowerCase() === 'accepted'
  if (condition?.type === 'SCORE') return Number(progress?.bestScore || 0) >= Number(condition.value || 0)
  if (condition?.type === 'TIME') return Number(progress?.activeSeconds || 0) >= Number(condition.value || 0)
  if (condition?.type === 'ATTEMPTS') return Number(progress?.attemptCount || 0) >= Number(condition.value || 0)
  return false
}

function requiredStageProblemIds(stage: SessionShape['Stages'][number], participantId: string) {
  const assignment = stage.ParticipantAssignments.find(item => item.participantId === participantId)
  const groupId = stage.audienceMode === 'GROUPED' ? assignment?.groupId || null : null
  if (stage.audienceMode === 'GROUPED' && !groupId) return new Set<string>()
  return new Set(stage.Problems
    .filter(problem => problem.Plans.some(plan => plan.groupId === groupId))
    .map(problem => problem.id))
}

type TrainingRequirementState = 'REQUIRED' | 'SATISFIED' | 'BYPASSED' | 'RETIRED'

type RequirementProgress = {
  stageProblemId: string
  status: string
}

function resolveParticipantStageRequirements(
  stage: SessionShape['Stages'][number],
  participantId: string,
  progressRows: RequirementProgress[] = [],
) {
  const requiredIds = requiredStageProblemIds(stage, participantId)
  const stageProblemIds = new Set(stage.Problems.map(problem => problem.id))
  const progressById = new Map(
    progressRows
      .filter(progress => stageProblemIds.has(progress.stageProblemId))
      .map(progress => [progress.stageProblemId, progress] as const),
  )
  const visibleIds = new Set([...requiredIds, ...progressById.keys()])
  return [...visibleIds].map(stageProblemId => {
    const progress = progressById.get(stageProblemId)
    let state: TrainingRequirementState
    if (!requiredIds.has(stageProblemId)) state = 'RETIRED'
    else if (progress?.status === 'SKIPPED') state = 'BYPASSED'
    else if (progress?.status === 'COMPLETED') state = 'SATISFIED'
    else state = 'REQUIRED'
    return { stageProblemId, state, progress }
  })
}

function resolveParticipantSessionRequirements(
  session: SessionShape,
  participantId: string,
  progressRows: RequirementProgress[] = [],
) {
  return session.Stages.flatMap(stage =>
    resolveParticipantStageRequirements(stage, participantId, progressRows)
      .map(requirement => ({ ...requirement, stageId: stage.id })),
  )
}

function requiredSessionProblemIds(session: SessionShape, participantId: string) {
  return new Set(
    resolveParticipantSessionRequirements(session, participantId)
      .filter(requirement => requirement.state !== 'RETIRED')
      .map(requirement => requirement.stageProblemId),
  )
}

type TrainingPermissionResult = {
  canView: boolean
  canSubmit: boolean
  canEdit: boolean
  canOpenHint: boolean
  reason: string
}

function resolveTrainingPermissionLoaded(
  session: SessionShape,
  manager: boolean,
  participant: any,
  stageProblemId: string | null | undefined,
  overrides: any[],
  progressByProblem: Map<string, any>,
): TrainingPermissionResult {
  if (manager) return { canView: true, canSubmit: session.status === 'RUNNING', canEdit: true, canOpenHint: true, reason: 'ADMIN_OVERRIDE' }
  if (!participant || participant.status !== 'active') return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'NOT_PARTICIPANT' }
  if (!stageProblemId) {
    if (session.status === 'DRAFT') return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'SESSION_NOT_RUNNING' }
    if (session.status === 'SCHEDULED') return { canView: true, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'PROBLEM_REQUIRED' }
    if (session.status === 'ENDED' || session.status === 'ARCHIVED') return { canView: true, canSubmit: false, canEdit: false, canOpenHint: session.allowHints, reason: 'SESSION_ENDED' }
    if (session.status === 'PAUSED') return { canView: true, canSubmit: false, canEdit: session.pauseMode !== 'HARD', canOpenHint: false, reason: session.pauseMode === 'HARD' ? 'HARD_PAUSE' : 'SOFT_PAUSE' }
    return { canView: true, canSubmit: false, canEdit: true, canOpenHint: session.allowHints, reason: 'PROBLEM_REQUIRED' }
  }

  const activeStageId = session.currentStageId
  const stage = activeStageId ? session.Stages.find(item => item.id === activeStageId) : null
  const problemStage = session.Stages.find(item => item.Problems.some(problem => problem.id === stageProblemId))
  const stageProblem = problemStage?.Problems.find(problem => problem.id === stageProblemId)
  if (!stage || !problemStage || !stageProblem) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'PROBLEM_NOT_IN_SESSION' }

  if (session.status === 'ENDED' || session.status === 'ARCHIVED') {
    return { canView: true, canSubmit: false, canEdit: false, canOpenHint: session.allowHints, reason: 'SESSION_ENDED' }
  }
  if (session.status === 'DRAFT') return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'SESSION_NOT_RUNNING' }

  const unlocked = overrides.some(item => item.type === 'UNLOCK_PROBLEM' && (!item.stageProblemId || item.stageProblemId === stageProblemId))
  const submissionOverride = overrides.some(item => item.type === 'ENABLE_SUBMISSION')
  const overlays = session.Overlays.filter(item => targetApplies(item.targetType, item.targetId, participant, session))
  const focus = [...overlays].reverse().find(item => ['SOFT_FOCUS', 'LOCKED_FOCUS', 'EXAM_FOCUS'].includes(item.type))

  if (focus && focus.type !== 'SOFT_FOCUS' && focus.stageProblemId !== stageProblemId && !unlocked) {
    return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'FOCUS_LOCK' }
  }
  if (overlays.some(item => item.type === 'LOCK_PROBLEM' && item.stageProblemId === stageProblemId) && !unlocked) {
    return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'PROBLEM_LOCKED' }
  }

  if (problemStage.id !== stage.id && !unlocked && focus?.stageProblemId !== stageProblemId) {
    const accessScope = normalizeTrainingAccessScope(parseJsonObject(stage.rules).accessScope)
    if (problemStage.orderIndex > stage.orderIndex) {
      if (accessScope !== 'SESSION_ALL') return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'FUTURE_STAGE' }
      return { canView: true, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'SESSION_SCOPE_READONLY' }
    }
    if (!['PREVIOUS_AND_CURRENT', 'SESSION_ALL'].includes(accessScope)) {
      return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'HISTORICAL_STAGE_OUT_OF_SCOPE' }
    }
    return { canView: true, canSubmit: false, canEdit: false, canOpenHint: session.allowHints, reason: 'HISTORICAL_STAGE' }
  }

  const assignment = stage.ParticipantAssignments.find(item => item.participantId === participant.id)
  const plan = stageProblem.Plans.find(item => item.groupId === (stage.audienceMode === 'GROUPED' ? assignment?.groupId || null : null))
  if (!plan && !unlocked) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'PROBLEM_NOT_ASSIGNED' }
  const group = assignment?.groupId ? stage.Groups.find(item => item.id === assignment.groupId) : null
  const effectiveRule = resolveEffectiveTrainingRule({ stage, group, plan })
  const accessPolicy = effectiveRule.problemAccessPolicy

  if (accessPolicy === 'TEACHER_CONTROLLED' && !unlocked) {
    const focusedStageProblemId = focus?.stageProblemId || participant.currentProblemId || stage.Problems[0]?.id
    if (focusedStageProblemId !== stageProblemId) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'FOCUS_REQUIRED' }
  }

  if (accessPolicy === 'SEQUENTIAL' && !unlocked) {
    const ordered = stage.Problems.flatMap(problem => problem.Plans.map(item => ({ ...item, problem })))
      .filter(item => item.groupId === (stage.audienceMode === 'GROUPED' ? assignment?.groupId || null : null))
      .sort((a, b) => a.orderIndex - b.orderIndex)
    const index = ordered.findIndex(item => item.stageProblemId === stageProblemId)
    if (index > 0) {
      const previous = ordered[index - 1]
      const previousProgress = progressByProblem.get(previous.stageProblemId)
      const policy = parseJsonObject(plan?.unlockPolicy || parseJsonObject(group?.rules || stage.rules).defaultUnlock || { mode: 'ANY', conditions: [{ type: 'AC' }] })
      const conditions = Array.isArray(policy.conditions) ? policy.conditions : [{ type: 'AC' }]
      const passed = String(policy.mode || 'ANY') === 'ALL'
        ? conditions.every(item => conditionSatisfied(item, previousProgress))
        : conditions.some(item => conditionSatisfied(item, previousProgress))
      if (!passed) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'SEQUENTIAL_LOCK' }
    }
  }

  if (session.status === 'SCHEDULED') return { canView: true, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'SESSION_NOT_RUNNING' }
  if (session.status === 'PAUSED') return { canView: true, canSubmit: false, canEdit: session.pauseMode !== 'HARD', canOpenHint: false, reason: session.pauseMode === 'HARD' ? 'HARD_PAUSE' : 'SOFT_PAUSE' }

  if (overlays.some(item => item.type === 'DISABLE_SUBMISSION') && !submissionOverride) {
    return { canView: true, canSubmit: false, canEdit: true, canOpenHint: session.allowHints, reason: 'SUBMISSION_DISABLED' }
  }

  const currentProgress = progressByProblem.get(stageProblemId)
  const timeState = evaluateProblemTimePolicy(
    effectiveRule.timePolicy,
    Number(currentProgress?.continuousActiveSeconds || 0),
    Boolean(currentProgress?.acAt || currentProgress?.status === 'COMPLETED'),
  )
  if (!unlocked && timeState.reached && !timeState.canSubmit) {
    return {
      canView: true,
      canSubmit: false,
      canEdit: true,
      canOpenHint: session.allowHints && focus?.type !== 'EXAM_FOCUS',
      reason: timeState.action === 'FORCE_SWITCH' ? 'FORCED_SWITCH_REQUIRED' : 'PROBLEM_TIME_LIMIT_REACHED',
    }
  }

  const canSubmit = (effectiveRule.submissionPolicy === 'ENABLED' && session.defaultSubmissionMode === 'ENABLED') || submissionOverride
  return { canView: true, canSubmit, canEdit: true, canOpenHint: session.allowHints && effectiveRule.hintPolicy.enabled && focus?.type !== 'EXAM_FOCUS', reason: canSubmit ? 'ALLOWED' : 'SUBMISSION_DISABLED' }
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
  const resolved = resolveTrainingPermissionLoaded(session, false, participant, stageProblemId, overrides, new Map(progress.map(item => [item.stageProblemId, item])))
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
  const stageId = session.currentStageId || session.Stages[0]?.id
  return prisma.trainingSessionParticipant.upsert({ where: { sessionId_userId: { sessionId, userId } }, update: { status: 'active', currentStageId: stageId }, create: { sessionId, userId, currentStageId: stageId } })
}

export async function listTrainingSessions(userId: string, query: any) {
  const role = await globalRole(userId)
  if (!role || role.status !== 'active') throw new TrainingEngineError(401, 'UNAUTHENTICATED', '请先登录')
  const teamId = query?.teamId ? String(query.teamId) : null, organizationId = query?.organizationId ? String(query.organizationId) : null
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

async function createStageSnapshot(tx: Prisma.TransactionClient, stageId: string) {
  const stage = await tx.trainingSessionStage.findUniqueOrThrow({ where: { id: stageId }, include: {
    Problems: { orderBy: { orderIndex: 'asc' }, include: { Plans: { orderBy: { orderIndex: 'asc' } }, TestSetRevision: { select: { id: true, revisionNumber: true, judgeConfigHash: true, mode: true } } } },
    Groups: { orderBy: { orderIndex: 'asc' }, include: { Assignments: { orderBy: { participantId: 'asc' } }, ProblemPlans: { orderBy: { orderIndex: 'asc' } } } },
  } })
  const projection = {
    stage: { id: stage.id, name: stage.name, description: stage.description, orderIndex: stage.orderIndex, kind: stage.kind, audienceMode: stage.audienceMode, endPolicy: stage.endPolicy, accessPolicy: stage.accessPolicy, submissionMode: stage.submissionMode, plannedDurationSeconds: stage.plannedDurationSeconds, defaultTargetScore: stage.defaultTargetScore, completionThreshold: stage.completionThreshold, minDurationSeconds: stage.minDurationSeconds, rules: stage.rules, definitionRevision: stage.definitionRevision },
    groups: stage.Groups.map(group => ({ id: group.id, name: group.name, orderIndex: group.orderIndex, accessPolicy: group.accessPolicy, submissionMode: group.submissionMode, rules: group.rules, assignments: group.Assignments.map(item => ({ participantId: item.participantId })), plans: group.ProblemPlans.map(plan => ({ ...plan, createdAt: undefined, updatedAt: undefined })) })),
    problems: stage.Problems.map(problem => ({ id: problem.id, problemId: problem.problemId, testSetRevisionId: problem.testSetRevisionId, revisionNumber: problem.TestSetRevision.revisionNumber, judgeConfigHash: problem.TestSetRevision.judgeConfigHash, mode: problem.TestSetRevision.mode, alias: problem.alias, plans: problem.Plans.map(plan => ({ ...plan, createdAt: undefined, updatedAt: undefined })) })),
  }
  const projectionHash = crypto.createHash('sha256').update(stableJson(projection)).digest('hex')
  return tx.trainingSessionStageRuntimeSnapshot.create({ data: { stageId, definitionRevision: stage.definitionRevision, projection: asJson(projection)!, projectionHash } })
}

async function startStage(tx: Prisma.TransactionClient, sessionId: string, stageId: string, at: Date, running = true) {
  const stage = await tx.trainingSessionStage.findFirst({ where: { id: stageId, sessionId }, include: { RuntimeSnapshot: true } })
  if (!stage || stage.lifecycle !== 'PENDING') throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_PENDING', '目标 Stage 不是待开始状态')
  await tx.trainingSessionStageGroupChange.updateMany({ where: { sessionId, targetStageId: stageId, effectiveMode: 'NEXT_STAGE', effectiveAt: null }, data: { effectiveAt: at } })
  if (!stage.RuntimeSnapshot) await createStageSnapshot(tx, stage.id)
  await tx.trainingSessionStage.update({ where: { id: stage.id }, data: { lifecycle: 'RUNNING', startedAt: at, runningSince: running ? at : null, endedAt: null, endedBy: null, endReason: null, endNote: null } })
  await tx.trainingSession.update({ where: { id: sessionId }, data: { currentStageId: stage.id } })
  await tx.trainingSessionParticipant.updateMany({ where: { sessionId, status: 'active' }, data: { currentStageId: stage.id, currentProblemId: null } })
  return stage
}

function activeStageIncrement(stage: { runningSince: Date | null }, at: Date) {
  return stage.runningSince ? Math.max(0, Math.floor((at.getTime() - stage.runningSince.getTime()) / 1000)) : 0
}

type StageTransitionAction = 'start' | 'advance' | 'skip_pending' | 'end_session'

async function applyStageTransition(tx: Prisma.TransactionClient, input: {
  sessionId: string
  actorUserId: string | null
  action: StageTransitionAction
  stageId: string
  outcome?: 'completed' | 'ended_early'
  endReason?: 'TIME_REACHED' | 'COMPLETION_REACHED' | 'HYBRID_REACHED' | 'TEACHER_ENDED' | 'TEACHER_ENDED_EARLY' | 'SESSION_ENDED' | 'SYSTEM_ENDED'
  nextStageId?: string | null
  reason?: string | null
  expectedRevision?: number
  automatic?: boolean
  endWhenNoNext?: boolean
  metadata?: Record<string, unknown>
}) {
  const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: input.sessionId }, include: { Stages: { orderBy: { orderIndex: 'asc' } } } })
  if (input.expectedRevision !== undefined && current.statusRevision !== input.expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
  const at = new Date()
  const eventMeta = { ...(input.metadata || {}), ...(input.automatic ? { automatic: true } : {}) }

  if (input.action === 'start') {
    if (current.status !== 'SCHEDULED') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有已发布训练可以开始')
    const first = current.Stages.find(stage => stage.lifecycle === 'PENDING')
    if (!first) throw new TrainingEngineError(422, 'TRAINING_STRUCTURE_INCOMPLETE', '训练没有待开始 Stage')
    if (input.stageId !== first.id) throw new TrainingEngineError(409, 'TRAINING_NEXT_STAGE_INVALID', '只能从时间轴中的第一个待开始 Stage 启动')
    await startStage(tx, input.sessionId, first.id, at)
    await tx.trainingSession.update({ where: { id: input.sessionId }, data: { status: 'RUNNING', startedAt: current.startedAt || at, runningSince: at, pausedAt: null, pauseMode: null, statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, input.sessionId, 'training.stage.started', 'ALL', null, { stageId: first.id, ...eventMeta })
    trainingMetrics.recordStageTransition()
    trainingMetrics.observeSession(input.sessionId, 'RUNNING')
    return 'started' as const
  }

  if (input.action === 'skip_pending') {
    const stage = current.Stages.find(item => item.id === input.stageId)
    if (!stage || stage.lifecycle !== 'PENDING') throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_PENDING', '只能跳过尚未开始的 Stage')
    await tx.trainingSessionStage.update({ where: { id: stage.id }, data: { lifecycle: 'SKIPPED', endedAt: at, endedBy: input.actorUserId, endNote: input.reason } })
    await tx.trainingSession.update({ where: { id: input.sessionId }, data: { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, input.sessionId, 'training.stage.skipped', 'ALL', null, { stageId: stage.id, reason: input.reason, ...eventMeta })
    trainingMetrics.recordStageTransition()
    trainingMetrics.observeSession(input.sessionId, current.status)
    return 'skipped' as const
  }

  const running = current.Stages.find(stage => stage.id === current.currentStageId && stage.lifecycle === 'RUNNING')
  if (!running || running.id !== input.stageId || !['RUNNING', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '当前没有运行中的 Stage')
  const increment = current.status === 'RUNNING' ? activeStageIncrement(running, at) : 0
  const outcome = input.outcome || 'completed'
  const next = input.nextStageId
    ? current.Stages.find(stage => stage.id === input.nextStageId)
    : current.Stages.find(stage => stage.orderIndex > running.orderIndex && stage.lifecycle === 'PENDING')
  const shouldEnd = input.action === 'end_session' || (!next && input.endWhenNoNext)
  const endReason = input.endReason || (
    input.action === 'end_session'
      ? 'SESSION_ENDED'
      : outcome === 'ended_early'
        ? 'TEACHER_ENDED_EARLY'
        : input.automatic
          ? 'SYSTEM_ENDED'
          : 'TEACHER_ENDED'
  )

  await tx.trainingSessionStage.update({ where: { id: running.id }, data: { lifecycle: 'ENDED', activeElapsedSeconds: { increment }, runningSince: null, endedAt: at, endedBy: input.actorUserId, endReason, endNote: input.reason } })
  if (shouldEnd) {
    await tx.trainingSessionStage.updateMany({ where: { sessionId: input.sessionId, lifecycle: 'PENDING' }, data: { lifecycle: 'SKIPPED', endedAt: at, endedBy: input.actorUserId, endNote: input.reason || '整场训练已结束' } })
    await tx.trainingSessionOverlay.updateMany({ where: { sessionId: input.sessionId, status: 'active' }, data: { status: 'ended', endedAt: at } })
    await tx.trainingSession.update({ where: { id: input.sessionId }, data: { status: 'ENDED', endedAt: at, runningSince: null, pausedAt: null, pauseMode: null, activeElapsedSeconds: { increment: increment }, statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, input.sessionId, 'training.session.ended', 'ALL', null, { stageId: running.id, outcome, endReason, reason: input.reason, ...eventMeta })
    trainingMetrics.recordStageTransition()
    trainingMetrics.observeSession(input.sessionId, 'ENDED')
    return 'ended' as const
  }

  if (!next || next.lifecycle !== 'PENDING' || next.orderIndex <= running.orderIndex) throw new TrainingEngineError(409, 'TRAINING_NEXT_STAGE_INVALID', '只能进入当前 Stage 之后的待开始 Stage')
  await startStage(tx, input.sessionId, next.id, at, current.status === 'RUNNING')
  await tx.trainingSession.update({ where: { id: input.sessionId }, data: { status: current.status === 'PAUSED' ? 'PAUSED' : 'RUNNING', runningSince: current.status === 'RUNNING' ? at : null, activeElapsedSeconds: { increment }, statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
  await appendEvent(tx, input.sessionId, 'training.stage.advanced', 'ALL', null, { fromStageId: running.id, toStageId: next.id, outcome, endReason, reason: input.reason, ...eventMeta })
  trainingMetrics.recordStageTransition()
  trainingMetrics.observeSession(input.sessionId, current.status)
  return 'advanced' as const
}

export async function executeStageTransition(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  if (expectedRevision !== session.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
  const action = String(body?.action || '').toLowerCase()
  if (!['start', 'advance', 'skip_pending', 'end_session'].includes(action)) throw new TrainingEngineError(422, 'INVALID_TRAINING_STAGE_TRANSITION', '不支持的 Stage 转换')
  const reason = body?.reason ? boundedText(body.reason, 2000, '转换原因', 1) : null
  const outcome = String(body?.outcome || 'completed').toLowerCase()
  if (action === 'advance' && !['completed', 'ended_early'].includes(outcome)) throw new TrainingEngineError(422, 'INVALID_TRAINING_STAGE_OUTCOME', 'Stage 结果不受支持')
  if ((action === 'skip_pending' || outcome === 'ended_early') && !reason) throw new TrainingEngineError(422, 'TRAINING_STAGE_REASON_REQUIRED', '提前结束或跳过 Stage 必须填写原因')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
    await applyStageTransition(tx, { sessionId, actorUserId: userId, action: action as StageTransitionAction, stageId: String(body?.stageId || ''), outcome: outcome as 'completed' | 'ended_early', endReason: action === 'end_session' ? 'SESSION_ENDED' : outcome === 'ended_early' ? 'TEACHER_ENDED_EARLY' : 'TEACHER_ENDED', nextStageId: body?.nextStageId ? String(body.nextStageId) : null, reason, expectedRevision })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function getTrainingStageGroupSuggestions(userId: string, sessionId: string, stageId: string) {
  await assertManage(userId, sessionId)
  const stage = await prisma.trainingSessionStage.findFirst({
    where: { id: stageId, sessionId },
    include: {
      Groups: { orderBy: { orderIndex: 'asc' } },
      Session: {
        include: {
          Stages: { orderBy: { orderIndex: 'asc' }, select: { id: true, orderIndex: true, Problems: { select: { id: true } } } },
          Participants: {
            where: { status: 'active' },
            include: { User: { select: { id: true, username: true, avatar: true } }, Progress: { select: { stageProblemId: true, status: true, bestScore: true, attemptCount: true, activeSeconds: true } } },
          },
        },
      },
    },
  })
  if (!stage) throw new TrainingEngineError(404, 'TRAINING_STAGE_NOT_FOUND', 'Stage 不存在')
  if (stage.lifecycle !== 'PENDING' || stage.audienceMode !== 'GROUPED' || !stage.Groups.length) throw new TrainingEngineError(409, 'TRAINING_GROUP_SUGGESTION_UNAVAILABLE', '只能为尚未开始的分组 Stage 生成建议')
  const previousProblemIds = new Set(stage.Session.Stages.filter(item => item.orderIndex < stage.orderIndex).flatMap(item => item.Problems.map(problem => problem.id)))
  const ranked = stage.Session.Participants.map(participant => {
    const prior = participant.Progress.filter(progress => previousProblemIds.has(progress.stageProblemId))
    const completed = prior.filter(progress => progress.status === 'COMPLETED').length
    const score = prior.reduce((total, progress) => total + (progress.bestScore || 0), 0)
    const attempts = prior.reduce((total, progress) => total + progress.attemptCount, 0)
    const activeSeconds = prior.reduce((total, progress) => total + progress.activeSeconds, 0)
    return { participant, completed, score, attempts, activeSeconds }
  }).sort((a, b) => b.completed - a.completed || b.score - a.score || a.attempts - b.attempts || a.activeSeconds - b.activeSeconds || a.participant.User.username.localeCompare(b.participant.User.username))
  const suggestions = ranked.map((entry, index) => {
    const round = Math.floor(index / stage.Groups.length)
    const groupIndex = round % 2 === 0 ? index % stage.Groups.length : stage.Groups.length - 1 - (index % stage.Groups.length)
    const group = stage.Groups[groupIndex]
    return {
      participantId: entry.participant.id,
      user: entry.participant.User,
      groupId: group.id,
      groupName: group.name,
      reason: previousProblemIds.size
        ? `上一阶段完成 ${entry.completed} 题，累计 ${entry.score} 分，尝试 ${entry.attempts} 次；按可解释的蛇形均衡顺序建议分组`
        : '前序阶段暂无可用进度，按用户名稳定排序后均衡分组',
    }
  })
  return { stageId: stage.id, suggestions }
}

export async function changeTrainingStageGroup(userId: string, sessionId: string, stageId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  if (expectedRevision !== session.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
  const effectiveMode = String(body?.effectiveMode || '').toUpperCase()
  if (!['IMMEDIATE', 'NEXT_STAGE'].includes(effectiveMode)) throw new TrainingEngineError(422, 'INVALID_TRAINING_GROUP_CHANGE', '换组生效方式不受支持')
  const reason = boundedText(body?.reason, 2000, '换组原因', 1)
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    const participant = await tx.trainingSessionParticipant.findFirst({ where: { id: String(body?.participantId || ''), sessionId, status: 'active' } })
    if (!participant) throw new TrainingEngineError(404, 'TRAINING_PARTICIPANT_NOT_FOUND', '学员不属于当前训练')
    const targetStageId = effectiveMode === 'NEXT_STAGE' ? String(body?.targetStageId || '') : stageId
    const targetStage = await tx.trainingSessionStage.findFirst({ where: { id: targetStageId, sessionId, audienceMode: 'GROUPED' } })
    if (!targetStage) throw new TrainingEngineError(422, 'TRAINING_STAGE_GROUP_UNAVAILABLE', '目标 Stage 不支持分组')
    if (effectiveMode === 'IMMEDIATE' && (current.currentStageId !== stageId || targetStage.lifecycle !== 'RUNNING')) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '立即换组只能作用于当前运行 Stage')
    if (effectiveMode === 'NEXT_STAGE' && targetStage.lifecycle !== 'PENDING') throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_PENDING', '下一 Stage 换组只能预设待开始 Stage')
    const toGroup = await tx.trainingSessionStageGroup.findFirst({ where: { id: String(body?.toGroupId || ''), stageId: targetStageId } })
    if (!toGroup) throw new TrainingEngineError(422, 'TRAINING_GROUP_NOT_FOUND', '目标分组不属于目标 Stage')
    const old = await tx.trainingSessionStageParticipantAssignment.findUnique({ where: { stageId_participantId: { stageId: targetStageId, participantId: participant.id } } })
    await tx.trainingSessionStageParticipantAssignment.upsert({ where: { stageId_participantId: { stageId: targetStageId, participantId: participant.id } }, update: { groupId: toGroup.id, assignedAt: new Date(), assignedBy: userId, source: effectiveMode.toLowerCase() }, create: { stageId: targetStageId, participantId: participant.id, groupId: toGroup.id, assignedBy: userId, source: effectiveMode.toLowerCase() } })
    let clearCurrentProblem = false
    if (effectiveMode === 'IMMEDIATE' && participant.currentProblemId) {
      const allowed = await tx.trainingSessionStageProblemPlan.findFirst({ where: { stageId, groupId: toGroup.id, stageProblemId: participant.currentProblemId } })
      clearCurrentProblem = !allowed
      if (clearCurrentProblem) await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { currentProblemId: null } })
    }
    const now = new Date()
    await tx.trainingSessionStageGroupChange.create({ data: { sessionId, stageId, participantId: participant.id, fromGroupId: old?.groupId || null, toGroupId: toGroup.id, effectiveMode: effectiveMode as any, targetStageId: effectiveMode === 'NEXT_STAGE' ? targetStageId : null, reason, changedBy: userId, effectiveAt: effectiveMode === 'IMMEDIATE' ? now : null } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'training.stage.group_changed', 'USER', participant.userId, { stageId, targetStageId, fromGroupId: old?.groupId || null, toGroupId: toGroup.id, effectiveMode, clearCurrentProblem })
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
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision || current.currentStageId !== stageId) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '当前 Stage 已变化，请刷新')
    const stage = await tx.trainingSessionStage.findFirst({ where: { id: stageId, sessionId, lifecycle: 'RUNNING' } })
    if (!stage) throw new TrainingEngineError(409, 'TRAINING_STAGE_NOT_RUNNING', '只能延长当前运行 Stage')
    await tx.trainingSessionStageTimeAdjustment.create({ data: { stageId, seconds, reason, createdBy: userId } })
    await tx.trainingSession.update({ where: { id: sessionId }, data: { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
    await appendEvent(tx, sessionId, 'training.stage.time_extended', 'ALL', null, { stageId, seconds, reason })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function getTrainingWorkspace(userId: string, sessionId: string) {
  const session = await assertAccess(userId, sessionId)
  const manager = await canManageSession(userId, session)
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  const progress = participant ? await prisma.trainingSessionProblemProgress.findMany({ where: { participantId: participant.id } }) : []
  const decisions = participant ? await prisma.trainingSessionStrategyDecision.findMany({ where: { sessionId, participantId: participant.id }, orderBy: { createdAt: 'desc' } }) : []
  const latestDecision = new Map<string, typeof decisions[number]>()
  for (const decision of decisions) if (decision.stageProblemId && !latestDecision.has(decision.stageProblemId)) latestDecision.set(decision.stageProblemId, decision)
  const progressByProblem = new Map(progress.map(item => [item.stageProblemId, item]))
  const strategy = Object.fromEntries(session.Stages.flatMap(stage => stage.Problems.map(item => ({ stage, item }))).map(({ stage, item }) => {
    const itemProgress = progressByProblem.get(item.id)
    const last = latestDecision.get(item.id)
    const assignment = participant ? stage.ParticipantAssignments.find(candidate => candidate.participantId === participant.id) : null
    const group = assignment?.groupId ? stage.Groups.find(candidate => candidate.id === assignment.groupId) : null
    const plan = item.Plans.find(candidate => candidate.groupId === (stage.audienceMode === 'GROUPED' ? assignment?.groupId || null : null)) || item.Plans[0]
    const effectiveRule = resolveEffectiveTrainingRule({ stage, group, plan })
    const timeState = evaluateProblemTimePolicy(
      effectiveRule.timePolicy,
      Number(itemProgress?.continuousActiveSeconds || 0),
      Boolean(itemProgress?.acAt || itemProgress?.status === 'COMPLETED'),
    )
    return [item.id, {
      intervalSeconds: plan?.strategyIntervalSeconds || item.strategyIntervalSeconds,
      effectiveRule,
      timePolicy: effectiveRule.timePolicy,
      timeLimitReached: timeState.reached,
      timeAction: timeState.action,
      remind: timeState.remind,
      switchRecommended: timeState.switchRecommended,
      switchRequired: timeState.switchRequired,
      scorePolicy: effectiveRule.scorePolicy,
      nextScoreTarget: resolveNextScoreTarget(effectiveRule.scorePolicy, itemProgress?.bestScore),
      decisionDue: Boolean((plan?.strategyIntervalSeconds || item.strategyIntervalSeconds) && (itemProgress?.activeSeconds || 0) - (last?.activeSecondsAtDecision || 0) >= Number(plan?.strategyIntervalSeconds || item.strategyIntervalSeconds)),
      lastDecision: last ? { decision: last.decision, reason: last.reason, createdAt: last.createdAt } : null,
    }]
  }))
  const overrides = participant && !manager
    ? await prisma.trainingSessionUserOverride.findMany({ where: { sessionId, userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })
    : []
  const permissionStartedAt = performance.now()
  const permissions = Object.fromEntries(session.Stages.flatMap(stage => stage.Problems).map(item => {
    const permission = resolveTrainingPermissionLoaded(session, manager, participant, item.id, overrides, progressByProblem)
    return [item.id, { ...permission, canSeeMetadata: manager || permission.canView }] as const
  }))
  trainingMetrics.recordPermissionLatency(performance.now() - permissionStartedAt)
  const visibleOverlays = manager || !participant ? session.Overlays : session.Overlays.filter(overlay => targetApplies(overlay.targetType, overlay.targetId, participant, session))
  const currentStage = participant ? session.Stages.find(stage => stage.id === session.currentStageId) : null
  const currentAssignment = participant && currentStage ? currentStage.ParticipantAssignments.find(item => item.participantId === participant.id) : null
  const currentRequirements = participant && currentStage ? resolveParticipantStageRequirements(currentStage, participant.id, progress) : []
  const activeCurrentRequirements = currentRequirements.filter(requirement => requirement.state !== 'RETIRED')
  const completedCurrent = activeCurrentRequirements.filter(requirement => ['SATISFIED', 'BYPASSED'].includes(requirement.state)).length
  const participantView = participant ? {
    ...participant,
    currentStageId: session.currentStageId,
    currentGroupId: currentAssignment?.groupId || null,
    requiredCount: activeCurrentRequirements.length,
    completedCount: completedCurrent,
    requirements: currentRequirements.map(requirement => ({ stageProblemId: requirement.stageProblemId, state: requirement.state })),
  } : participant
  const snapshotProblem = (problem: any) => ({
    ...problem,
    Problem: { ...problem.Problem, title: problem.titleSnapshot },
    Statements: Array.isArray(problem.statementsSnapshot) ? problem.statementsSnapshot : [],
  })
  const sessionView = manager ? {
    ...session,
    Stages: session.Stages.map(stage => ({ ...stage, Problems: stage.Problems.map(snapshotProblem) })),
  } : {
    ...session,
    Stages: session.Stages.map(stage => ({
      ...stage,
      Problems: stage.Problems.map(problem => permissions[problem.id]?.canSeeMetadata ? snapshotProblem(problem) : {
        ...snapshotProblem(problem),
        alias: null,
        Statements: [],
        Problem: { ...problem.Problem, platform: '', problemId: '', title: '未开放题目', difficulty: null },
      }),
    })),
  }
  return { session: { ...sessionView, Overlays: visibleOverlays }, manager, participant: participantView, progress, permissions, strategy }
}

export async function replaceTrainingRoster(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  if (expectedRevision !== session.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练名单已变化，请刷新')
  const participants = Array.isArray(body?.participants) ? body.participants : []
  if (participants.length > 5000) throw new TrainingEngineError(422, 'TRAINING_ROSTER_TOO_LARGE', '学员数量超过上限')
  const eligible = new Set(await eligibleTrainingParticipantIds(session))
  const userIds: string[] = [...new Set<string>(participants.map((item: any) => String(item.userId || '')))].filter(Boolean)
  const invalid = userIds.filter(id => !eligible.has(id))
  if (invalid.length) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_OUT_OF_SCOPE', '名单中包含不属于当前学校或团队的账号')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
    const claimed = await tx.trainingSession.updateMany({ where: { id: sessionId, statusRevision: expectedRevision }, data: { statusRevision: { increment: 1 }, settings: asJson({ ...parseJsonObject(session.settings), rosterExplicit: true }) } })
    if (!claimed.count) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练名单已变化，请刷新')
    const requested = new Set(userIds)
    await tx.trainingSessionParticipant.updateMany({ where: { sessionId, userId: { notIn: userIds }, status: 'active' }, data: { status: 'removed' } })
    for (const item of participants) {
      const participantUserId = String(item.userId || '')
      if (!requested.has(participantUserId)) continue
      await tx.trainingSessionParticipant.upsert({ where: { sessionId_userId: { sessionId, userId: participantUserId } }, update: { status: 'active', currentStageId: session.currentStageId || session.Stages[0]?.id || null, currentProblemId: null, returnStageId: null, returnProblemId: null }, create: { sessionId, userId: participantUserId, currentStageId: session.currentStageId || session.Stages[0]?.id || null } })
    }
    await appendEvent(tx, sessionId, 'training.roster.updated', 'ALL', null, { participantCount: userIds.length })
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
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
    const current = await tx.trainingSession.findUniqueOrThrow({ where: { id: sessionId } })
    if (current.statusRevision !== expectedRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练状态已变化，请刷新')
    assertTrainingCommandAllowed(type, current.status)
    targetId = await normalizeCommandTarget(tx, session, targetType, targetId)
    let nextStatus: TrainingEngineSessionStatus | undefined
    const update: Prisma.TrainingSessionUpdateInput = { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } }
    if (type === 'PAUSE_SESSION') {
      if (current.status !== 'RUNNING') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有进行中的训练可以暂停')
      const at = new Date()
      nextStatus = 'PAUSED'; update.status = nextStatus; update.pausedAt = at; update.runningSince = null; update.pauseMode = payload.mode === 'HARD' ? 'HARD' : 'SOFT'
      if (current.runningSince) update.activeElapsedSeconds = { increment: Math.max(0, Math.floor((at.getTime() - current.runningSince.getTime()) / 1000)) }
      if (current.currentStageId) {
        const stage = await tx.trainingSessionStage.findUnique({ where: { id: current.currentStageId } })
        if (stage?.lifecycle === 'RUNNING') await tx.trainingSessionStage.update({ where: { id: stage.id }, data: { activeElapsedSeconds: { increment: activeStageIncrement(stage, at) }, runningSince: null } })
      }
    } else if (type === 'RESUME_SESSION') {
      if (current.status !== 'PAUSED') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有暂停中的训练可以恢复')
      nextStatus = 'RUNNING'; update.status = nextStatus; update.pausedAt = null; update.runningSince = new Date(); update.pauseMode = null
      if (current.currentStageId) {
        const stage = await tx.trainingSessionStage.findUnique({ where: { id: current.currentStageId } })
        if (stage?.lifecycle === 'RUNNING') await tx.trainingSessionStage.update({ where: { id: stage.id }, data: { runningSince: new Date() } })
      }
    } else if (type === 'FOCUS_PROBLEM') {
      if (current.status !== 'RUNNING') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有进行中的训练可以聚焦题目')
      const stageProblemId = String(payload.stageProblemId || '')
      if (!session.currentStageId || !session.Stages.find(stage => stage.id === session.currentStageId)?.Problems.some(problem => problem.id === stageProblemId)) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_IN_CURRENT_STAGE', '只能聚焦当前 Stage 的题目')
      await tx.trainingSessionOverlay.updateMany({ where: { sessionId, status: 'active', type: { in: ['SOFT_FOCUS', 'LOCKED_FOCUS', 'EXAM_FOCUS'] }, ...sameOverlayTarget(targetType, targetId) }, data: { status: 'ended', endedAt: new Date() } })
      await tx.trainingSessionOverlay.create({ data: { sessionId, type: ['SOFT_FOCUS', 'EXAM_FOCUS'].includes(String(payload.mode)) ? String(payload.mode) : 'LOCKED_FOCUS', targetType, targetId, stageProblemId, payload: asJson(payload), expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null, createdBy: userId } })
      const participants = await tx.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' } })
      for (const participant of participants.filter(item => targetApplies(targetType, targetId, item, session))) await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: {
        returnStageId: participant.returnStageId || participant.currentStageId,
        returnProblemId: participant.returnStageId || participant.returnProblemId ? participant.returnProblemId : participant.currentProblemId,
        currentProblemId: stageProblemId,
      } })
    } else if (type === 'END_FOCUS') {
      if (!['RUNNING', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '当前状态不能结束聚焦')
      await tx.trainingSessionOverlay.updateMany({ where: { sessionId, status: 'active', type: { in: ['SOFT_FOCUS', 'LOCKED_FOCUS', 'EXAM_FOCUS'] }, ...sameOverlayTarget(targetType, targetId) }, data: { status: 'ended', endedAt: new Date() } })
      const participants = await tx.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active', OR: [{ returnStageId: { not: null } }, { returnProblemId: { not: null } }] } })
      await restoreFocusParticipants(tx, session, participants.filter(item => targetApplies(targetType, targetId, item, session)))
    } else if (type === 'DISABLE_SUBMISSION' || type === 'LOCK_PROBLEM' || type === 'SHOW_MESSAGE') {
      if (!['RUNNING', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '当前状态不能应用实时规则')
      if (type === 'LOCK_PROBLEM' && !payload.stageProblemId) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_REQUIRED', '锁题命令必须指定训练题目')
      if (type === 'LOCK_PROBLEM' && (!session.currentStageId || !session.Stages.find(stage => stage.id === session.currentStageId)?.Problems.some(problem => problem.id === String(payload.stageProblemId)))) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_IN_CURRENT_STAGE', '只能锁定当前 Stage 的题目')
      if (type === 'SHOW_MESSAGE') {
        payload.message = boundedText(payload.message, 2000, '教练消息', 1)
        payload.messageType = ['INFO', 'WARNING', 'INSTRUCTION', 'COUNTDOWN'].includes(String(payload.messageType || '').toUpperCase()) ? String(payload.messageType).toUpperCase() : 'INFO'
      }
      await tx.trainingSessionOverlay.create({ data: { sessionId, type: type === 'SHOW_MESSAGE' ? 'MESSAGE' : type, targetType, targetId, stageProblemId: payload.stageProblemId ? String(payload.stageProblemId) : null, payload: asJson(payload), expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null, createdBy: userId } })
    } else if (type === 'ENABLE_SUBMISSION' || type === 'UNLOCK_PROBLEM' || type === 'CLEAR_MESSAGE') {
      if (type === 'UNLOCK_PROBLEM' && payload.stageProblemId && (!session.currentStageId || !session.Stages.find(stage => stage.id === session.currentStageId)?.Problems.some(problem => problem.id === String(payload.stageProblemId)))) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_IN_CURRENT_STAGE', '只能解锁当前 Stage 的题目')
      const endingType = type === 'ENABLE_SUBMISSION' ? 'DISABLE_SUBMISSION' : type === 'UNLOCK_PROBLEM' ? 'LOCK_PROBLEM' : 'MESSAGE'
      await tx.trainingSessionOverlay.updateMany({ where: { sessionId, status: 'active', type: endingType, ...sameOverlayTarget(targetType, targetId), ...(payload.stageProblemId ? { stageProblemId: String(payload.stageProblemId) } : {}) }, data: { status: 'ended', endedAt: new Date() } })
    } else if (type === 'UNLOCK_FOR_USER' || type === 'SKIP_FOR_USER') {
      if (targetType !== 'USER' || !targetId) throw new TrainingEngineError(422, 'TRAINING_COMMAND_TARGET_REQUIRED', '个人干预必须指定用户')
      const participant = await tx.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId: targetId } } })
      if (!participant) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_NOT_FOUND', '学员不在当前训练')
      if (payload.stageProblemId && (!session.currentStageId || !session.Stages.find(stage => stage.id === session.currentStageId)?.Problems.some(problem => problem.id === String(payload.stageProblemId)))) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_IN_CURRENT_STAGE', '个人干预只能作用于当前 Stage 的题目')
      await tx.trainingSessionUserOverride.create({ data: { sessionId, userId: targetId, type: type === 'SKIP_FOR_USER' ? 'SKIP_PROBLEM' : 'UNLOCK_PROBLEM', stageProblemId: payload.stageProblemId ? String(payload.stageProblemId) : null, payload: asJson(payload), expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null, createdBy: userId } })
      if (type === 'SKIP_FOR_USER' && payload.stageProblemId) await tx.trainingSessionProblemProgress.upsert({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: String(payload.stageProblemId) } }, update: { status: 'SKIPPED', lastProgressAt: new Date() }, create: { participantId: participant.id, stageProblemId: String(payload.stageProblemId), status: 'SKIPPED', lastProgressAt: new Date() } })
    } else if (type === 'OPEN_HINT' || type === 'CLOSE_HINT') {
      const hintId = String(payload.hintId || '')
      const hint = await tx.trainingSessionHint.findFirst({ where: { id: hintId, sessionId } })
      if (!hint) throw new TrainingEngineError(422, 'TRAINING_HINT_NOT_FOUND', '提示不存在')
      if (targetType === 'ALL') await tx.trainingSessionHint.update({ where: { id: hintId }, data: { globallyOpenedAt: type === 'OPEN_HINT' ? new Date() : null } })
      if (type === 'OPEN_HINT') {
        const existing = await tx.trainingSessionOverlay.findFirst({ where: { sessionId, status: 'active', type: 'HINT_OPEN', ...sameOverlayTarget(targetType, targetId), payload: { path: ['hintId'], equals: hintId } }, select: { id: true } })
        if (!existing) await tx.trainingSessionOverlay.create({ data: { sessionId, type: 'HINT_OPEN', targetType, targetId, stageProblemId: hint.stageProblemId, payload: { hintId }, createdBy: userId } })
      } else {
        await tx.trainingSessionOverlay.updateMany({ where: { sessionId, status: 'active', type: 'HINT_OPEN', ...sameOverlayTarget(targetType, targetId), payload: { path: ['hintId'], equals: hintId } }, data: { status: 'ended', endedAt: new Date() } })
      }
    }
    const updated = await tx.trainingSession.update({ where: { id: sessionId }, data: update })
    await tx.trainingSessionCommand.create({ data: { sessionId, seq: updated.commandSeq, type, targetType, targetId, payload: asJson(payload), createdBy: userId } })
    await appendEvent(tx, sessionId, `training.command.${type.toLowerCase()}`, targetType, targetId, { ...payload, status: nextStatus })
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
  const group = assignment?.groupId ? stage?.Groups.find(item => item.id === assignment.groupId) : null
  const plan = stageProblem?.Plans.find(item => item.groupId === (stage?.audienceMode === 'GROUPED' ? assignment?.groupId || null : null))
  if (!stage || !stageProblem) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  const effectiveRule = resolveEffectiveTrainingRule({ stage, group, plan })
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
    if (stuck && current.status !== 'STUCK') await tx.trainingSessionProblemProgress.update({ where: { id: current.id }, data: { status: 'STUCK', stuckDetectedAt: now } })
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
  const plan = stageProblem.Plans.find(item => item.groupId === (assignment?.groupId || null))
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
  const belongs = await prisma.trainingSessionStageProblem.findFirst({ where: { id: stageProblemId, Stage: { sessionId } }, include: { Stage: { select: { lifecycle: true } } } })
  if (!belongs) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  if (belongs.Stage.lifecycle !== 'PENDING') throw new TrainingEngineError(409, 'TRAINING_HINT_DEFINITION_FROZEN', 'Stage 开始后提示定义不可新增或修改，请使用运行时开放已有提示')
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
  if (hint.StageProblem.Stage.lifecycle !== 'PENDING') throw new TrainingEngineError(409, 'TRAINING_HINT_DEFINITION_FROZEN', 'Stage 开始后提示定义不可修改')
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
  if (hint.StageProblem.Stage.lifecycle !== 'PENDING') throw new TrainingEngineError(409, 'TRAINING_HINT_DEFINITION_FROZEN', 'Stage 开始后提示定义不可删除')
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
  const expiredOverlaySessions = await prisma.trainingSessionOverlay.findMany({
    where: { status: 'active', expiresAt: { lte: now } },
    distinct: ['sessionId'],
    select: { sessionId: true },
    take: 100,
  })
  for (const item of expiredOverlaySessions) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${item.sessionId}`}, 0)) IS NULL AS locked`
      const session = await tx.trainingSession.findUnique({ where: { id: item.sessionId }, select: { id: true, teamId: true } })
      if (!session) return
      const expired = await tx.trainingSessionOverlay.findMany({ where: { sessionId: item.sessionId, status: 'active', expiresAt: { lte: now } }, select: { id: true, type: true } })
      if (!expired.length) return
      await tx.trainingSessionOverlay.updateMany({ where: { id: { in: expired.map(overlay => overlay.id) }, status: 'active' }, data: { status: 'expired', endedAt: now } })
      if (expired.some(overlay => ['SOFT_FOCUS', 'LOCKED_FOCUS', 'EXAM_FOCUS'].includes(overlay.type))) {
        const participants = await tx.trainingSessionParticipant.findMany({ where: { sessionId: item.sessionId, status: 'active', OR: [{ returnStageId: { not: null } }, { returnProblemId: { not: null } }] } })
        await restoreFocusParticipants(tx, session, participants)
      }
      await appendEvent(tx, item.sessionId, 'training.overlay.expired', 'ALL', null, { overlayIds: expired.map(overlay => overlay.id) })
    })
  }
  const scheduled = await prisma.trainingSession.findMany({ where: { status: 'SCHEDULED', scheduledStartAt: { lte: now } }, select: { id: true, statusRevision: true }, take: 50 })
  let started = 0, advanced = 0, ended = 0
  for (const item of scheduled) {
    try {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${item.id}`}, 0)) IS NULL AS locked`
        const session = await tx.trainingSession.findUnique({ where: { id: item.id }, include: { Stages: { orderBy: { orderIndex: 'asc' } } } })
        if (!session || session.status !== 'SCHEDULED' || !session.Stages[0]) return
        await applyStageTransition(tx, { sessionId: session.id, actorUserId: null, action: 'start', stageId: session.Stages[0].id, automatic: true })
        started++
      })
    } catch { /* another worker or command won the state transition */ }
  }
  const running = await prisma.trainingSession.findMany({ where: { status: 'RUNNING', currentStageId: { not: null } }, include: { Stages: { orderBy: { orderIndex: 'asc' }, include: { Problems: { include: { Plans: true } }, ParticipantAssignments: true } }, Participants: { where: { status: 'active' }, include: { Progress: true } } }, take: 100 })
  for (const session of running) {
    const sessionSettings = parseJsonObject(session.settings)
    const dueAt = sessionSettings.dueAt ? new Date(String(sessionSettings.dueAt)) : null
    if (dueAt && Number.isFinite(dueAt.getTime()) && dueAt <= now) {
      try {
        await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${session.id}`}, 0)) IS NULL AS locked`
          const current = await tx.trainingSession.findUnique({ where: { id: session.id } })
          if (!current || current.status !== 'RUNNING') return
          if (!current.currentStageId) return
          await applyStageTransition(tx, { sessionId: session.id, actorUserId: null, action: 'end_session', stageId: current.currentStageId, outcome: 'ended_early', endReason: 'TIME_REACHED', reason: '到达训练截止时间', automatic: true, metadata: { reasonCode: 'due_at' } })
          ended++
        })
      } catch { /* another worker or coach ended the session */ }
      continue
    }
    const index = session.Stages.findIndex(stage => stage.id === session.currentStageId)
    const stage = session.Stages[index]
    if (!stage || stage.lifecycle !== 'RUNNING' || stage.endPolicy === 'MANUAL') continue
    const elapsed = stage.activeElapsedSeconds + activeStageIncrement(stage, now)
    const extensionSeconds = await prisma.trainingSessionStageTimeAdjustment.aggregate({ where: { stageId: stage.id }, _sum: { seconds: true } }).then(value => value._sum.seconds || 0)
    const effectiveDuration = (stage.plannedDurationSeconds || 0) + extensionSeconds
    const timeReady = Boolean(effectiveDuration && elapsed >= effectiveDuration)
    const completed = session.Participants.filter(participant => {
      const requirements = resolveParticipantStageRequirements(stage as any, participant.id, participant.Progress)
        .filter(requirement => requirement.state !== 'RETIRED')
      if (!requirements.length) return false
      const satisfiedCount = requirements.filter(requirement => ['SATISFIED', 'BYPASSED'].includes(requirement.state)).length
      const requiredCount = Number(parseJsonObject(stage.rules).requiredProblemCount || requirements.length)
      return satisfiedCount >= Math.min(requiredCount, requirements.length)
    }).length
    const completionRate = session.Participants.length ? Math.floor(completed * 100 / session.Participants.length) : 0
    const completionReady = Boolean(stage.completionThreshold && completionRate >= stage.completionThreshold && elapsed >= (stage.minDurationSeconds || 0))
    const due = stage.endPolicy === 'TIME' ? timeReady : stage.endPolicy === 'COMPLETION' ? completionReady : timeReady && completionReady
    if (!due) continue
    try {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${session.id}`}, 0)) IS NULL AS locked`
        const current = await tx.trainingSession.findUnique({ where: { id: session.id } })
        if (!current || current.status !== 'RUNNING' || current.currentStageId !== stage.id) return
        const next = session.Stages.slice(index + 1).find(item => item.lifecycle === 'PENDING')
        const automaticEndReason = stage.endPolicy === 'TIME' ? 'TIME_REACHED' : stage.endPolicy === 'COMPLETION' ? 'COMPLETION_REACHED' : 'HYBRID_REACHED'
        const result = await applyStageTransition(tx, { sessionId: session.id, actorUserId: null, action: 'advance', stageId: stage.id, outcome: 'completed', endReason: automaticEndReason, nextStageId: next?.id, reason: '自动达到阶段结束条件', automatic: true, endWhenNoNext: true, metadata: { completionRate } })
        if (result === 'advanced') advanced++
        if (result === 'ended') ended++
      })
    } catch { /* a manual command may have advanced it */ }
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
  const participants = await prisma.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, include: { User: { select: { id: true, username: true, avatar: true } }, StageAssignments: { where: { stageId: session.currentStageId || undefined }, select: { groupId: true } }, Progress: { include: { StageProblem: { include: { Problem: { select: { title: true, problemId: true } } } } } } } })
  const now = Date.now()
  const currentStage = session.Stages.find(stage => stage.id === session.currentStageId)
  const participantRows = participants.map(item => {
    const requirements = currentStage ? resolveParticipantStageRequirements(currentStage, item.id, item.Progress) : []
    const activeRequirements = requirements.filter(requirement => requirement.state !== 'RETIRED')
    const satisfiedCount = activeRequirements.filter(requirement => ['SATISFIED', 'BYPASSED'].includes(requirement.state)).length
    const requiredCount = currentStage ? Math.min(Number(parseJsonObject(currentStage.rules).requiredProblemCount || activeRequirements.length), activeRequirements.length) : 0
    const currentProblemIds = new Set(activeRequirements.map(requirement => requirement.stageProblemId))
    const currentProgress = item.Progress.filter(progress => currentProblemIds.has(progress.stageProblemId))
    return {
      id: item.id,
      user: item.User,
      currentStageId: session.currentStageId,
      currentProblemId: item.currentProblemId,
      currentGroupId: item.StageAssignments[0]?.groupId || null,
      activeSeconds: item.activeSeconds,
      online: Boolean(item.lastHeartbeatAt && now - item.lastHeartbeatAt.getTime() < 90_000),
      requiredCount,
      completedCount: satisfiedCount,
      completed: requiredCount > 0 && satisfiedCount >= requiredCount,
      working: currentProgress.some(progress => progress.status === 'WORKING'),
      stuck: currentProgress.some(progress => progress.status === 'STUCK'),
      requirements: requirements.map(requirement => ({ stageProblemId: requirement.stageProblemId, state: requirement.state })),
      progress: item.Progress.map(progress => ({ ...progress, code: undefined })),
    }
  })
  return { session: { id: session.id, title: session.title, status: session.status, currentStageId: session.currentStageId }, participants: participantRows, summary: { total: participants.length, working: participantRows.filter(item => item.working).length, stuck: participantRows.filter(item => item.stuck).length, completed: participantRows.filter(item => item.completed).length } }
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
  const where = manager ? { sessionId } : { sessionId, userId }
  const participants = await prisma.trainingSessionParticipant.findMany({ where, include: { User: { select: { id: true, username: true } }, Progress: { include: { StageProblem: { include: { Problem: { select: { title: true, problemId: true } } } } } }, ScoreEvents: { orderBy: { createdAt: 'asc' } } } })
  const timeline = session.Stages.map(stage => ({ id: stage.id, name: stage.name, kind: stage.kind, lifecycle: stage.lifecycle, plannedDurationSeconds: stage.plannedDurationSeconds, extensionSeconds: stage.TimeAdjustments.reduce((sum, item) => sum + item.seconds, 0), activeElapsedSeconds: stage.activeElapsedSeconds + (stage.lifecycle === 'RUNNING' ? activeStageIncrement(stage, new Date()) : 0), endedAt: stage.endedAt, endReason: stage.endReason, endNote: stage.endNote, snapshotHash: stage.RuntimeSnapshot?.projectionHash || null }))
  const groupChanges = await prisma.trainingSessionStageGroupChange.findMany({ where: { sessionId }, orderBy: { requestedAt: 'asc' }, select: { stageId: true, participantId: true, fromGroupId: true, toGroupId: true, effectiveMode: true, reason: true, effectiveAt: true, requestedAt: true } })
  const stageProblemById = new Map(session.Stages.flatMap(stage => stage.Problems.map(problem => [problem.id, problem] as const)))
  return { timeline, groupChanges, participants: participants.map(item => {
    const requirements = resolveParticipantSessionRequirements(session, item.id, item.Progress)
    const requirementByProblemId = new Map(requirements.map(requirement => [requirement.stageProblemId, requirement]))
    const progressById = new Map(item.Progress.map(progress => [progress.stageProblemId, progress]))
    const visibleIds = new Set([...requirementByProblemId.keys(), ...progressById.keys()])
    return { user: item.User, activeSeconds: item.activeSeconds, problems: [...visibleIds].flatMap(stageProblemId => {
      const stageProblem = stageProblemById.get(stageProblemId)
      if (!stageProblem) return []
      const progress = progressById.get(stageProblemId)
      const requirementState = requirementByProblemId.get(stageProblemId)?.state || 'RETIRED'
      return [{ title: stageProblem.Problem.title, problemId: stageProblem.Problem.problemId, status: progress?.status || 'NOT_STARTED', requirementState, activeSeconds: progress?.activeSeconds || 0, attemptCount: progress?.attemptCount || 0, bestScore: progress?.bestScore ?? null, bestVerdict: progress?.bestVerdict ?? null, hintCount: progress?.hintCount || 0, highestHintLevel: progress?.highestHintLevel || 0, stuckDetectedAt: progress?.stuckDetectedAt || null, scoreProgression: item.ScoreEvents.filter(event => event.stageProblemId === stageProblemId).map(event => ({ score: event.score, verdict: event.verdict, at: event.createdAt })) }]
    }) }
  }) }
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
      Stage: { select: { sessionId: true, kind: true, audienceMode: true, accessPolicy: true, submissionMode: true, endPolicy: true, defaultTargetScore: true, rules: true } },
      Plans: { include: { Group: { select: { id: true, accessPolicy: true, submissionMode: true, rules: true } } } },
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
    const assignment = await tx.trainingSessionStageParticipantAssignment.findUnique({ where: { stageId_participantId: { stageId: stageProblem.stageId, participantId: participant.id } } })
    const plan = stageProblem.Plans.find(item => item.groupId === (stageProblem.Stage.audienceMode === 'GROUPED' ? assignment?.groupId || null : null))
    const snapshottedGoal = parseJsonObject(submission.trainingScoreGoalSnapshot)
    const effectiveRule = resolveEffectiveTrainingRule({ stage: stageProblem.Stage, group: plan?.Group || null, plan })
    const targetScore = Number.isInteger(snapshottedGoal.score)
      ? Number(snapshottedGoal.score)
      : effectiveRule.scorePolicy.completionScore
    const completed = accepted || bestScore >= targetScore
    const nextStatus = completed ? 'COMPLETED' : existing?.status === 'STUCK' && !improved ? 'STUCK' : 'WORKING'
    await tx.trainingSessionProblemProgress.upsert({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: submission.trainingStageProblemId! } }, update: { attemptCount: { increment: 1 }, bestScore, bestVerdict: accepted || improved ? submission.result : existing?.bestVerdict, acAt: accepted ? existing?.acAt || new Date() : existing?.acAt, lastSubmissionAt: new Date(), lastScoreImprovedAt: improved ? new Date() : existing?.lastScoreImprovedAt, lastProgressAt: improved ? new Date() : existing?.lastProgressAt, status: nextStatus, stuckDetectedAt: improved || completed ? null : existing?.stuckDetectedAt }, create: { participantId: participant.id, stageProblemId: submission.trainingStageProblemId!, attemptCount: 1, bestScore, bestVerdict: submission.result, acAt: accepted ? new Date() : null, lastSubmissionAt: new Date(), lastScoreImprovedAt: new Date(), lastProgressAt: new Date(), status: completed ? 'COMPLETED' : 'WORKING' } })
    await tx.trainingSessionScoreEvent.create({ data: { sessionId: submission.trainingSessionId!, participantId: participant.id, stageProblemId: submission.trainingStageProblemId!, submissionId: submission.id, score: submission.score, verdict: submission.result } })
    await appendEvent(tx, submission.trainingSessionId!, 'training.progress.updated', 'USER', submission.userId, { stageProblemId: submission.trainingStageProblemId, score: submission.score, verdict: submission.result })
  })
}
