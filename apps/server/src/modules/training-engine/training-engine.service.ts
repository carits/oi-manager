import crypto from 'node:crypto'
import yaml from 'js-yaml'
import type { Prisma, TrainingEngineSessionStatus, TrainingEngineTargetType } from '@prisma/client'
import { prisma } from '../../prisma'
import { isOrganizationContestAdmin, isOrganizationMember, isTeamAdmin, isTeamMember } from '../training/training.helpers'
import { createQueuedSubmissionWithRun } from '../judge/application/judge-run.service'
import { normalizeSubmissionIo } from '../judge/domain/submission-io'
import { getBuiltinTrainingTemplate } from './training-engine.templates'

export class TrainingEngineError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) { super(message) }
}

type SessionShape = NonNullable<Awaited<ReturnType<typeof loadSession>>>
type StructureStage = {
  id?: string
  clientKey?: string
  name: string
  description?: string | null
  mode?: string
  durationSeconds?: number | null
  advanceMode?: string
  problemAccessMode?: string
  submissionMode?: string
  targetScore?: number | null
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
    timeLimitSeconds?: number | null
    hintPolicy?: unknown
    allowedSubtaskIds?: number[]
    strategyIntervalSeconds?: number | null
    maxContinuousWorkSeconds?: number | null
    forceSwitchOnTimeout?: boolean
  }>
}

const COMMANDS = new Set([
  'START_SESSION', 'PAUSE_SESSION', 'RESUME_SESSION', 'END_SESSION', 'ADVANCE_STAGE', 'BACK_STAGE',
  'FOCUS_PROBLEM', 'END_FOCUS', 'LOCK_PROBLEM', 'UNLOCK_PROBLEM', 'ENABLE_SUBMISSION', 'DISABLE_SUBMISSION',
  'OPEN_HINT', 'CLOSE_HINT', 'EXTEND_TIME', 'UNLOCK_FOR_USER', 'SKIP_FOR_USER', 'SHOW_MESSAGE', 'CLEAR_MESSAGE',
])
const SESSION_WIDE_COMMANDS = new Set([
  'START_SESSION', 'PAUSE_SESSION', 'RESUME_SESSION', 'END_SESSION', 'ADVANCE_STAGE', 'BACK_STAGE', 'EXTEND_TIME',
])
const SESSION_TYPES = new Set(['OI', 'ACM', 'GENERAL'])
const STAGE_MODES = new Set(['FREE', 'SEQUENTIAL', 'FOCUS', 'SCORE_PROGRESSIVE', 'TEACHING', 'REVIEW', 'MOCK_CONTEST'])
const ADVANCE_MODES = new Set(['MANUAL', 'TIME', 'COMPLETION', 'HYBRID'])
const ACCESS_MODES = new Set(['ALL', 'STAGE_ONLY', 'SEQUENTIAL', 'FOCUS_ONLY'])
const SUBMISSION_MODES = new Set(['ENABLED', 'DISABLED'])
const RANKING_MODES = new Set(['OFF', 'PROGRESS_ONLY', 'SCORE', 'ACM_RANKING'])
const PEER_VISIBILITY = new Set(['NONE', 'PROGRESS', 'SCORE', 'FULL'])
const JOIN_MODES = new Set(['CURRENT_STAGE', 'FROM_BEGINNING', 'TEACHER_ASSIGN'])
const HINT_OPEN_MODES = new Set(['MANUAL', 'TIME', 'ATTEMPT', 'SCORE'])

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

export async function loadSession(id: string) {
  return prisma.trainingSession.findUnique({ where: { id }, include: {
    Stages: { orderBy: { orderIndex: 'asc' }, include: { Problems: { orderBy: { orderIndex: 'asc' }, include: { Problem: { select: { id: true, platform: true, problemId: true, title: true, difficulty: true, timeLimit: true, memoryLimit: true } }, TestSetRevision: { select: { id: true, revisionNumber: true, mode: true, judgeConfigHash: true } } } } } },
    Groups: { orderBy: { orderIndex: 'asc' } },
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
  const allProblemIds = [...new Set(stages.flatMap(stage => (stage.problems || []).map(item => String(item.problemId))))]
  if (allProblemIds.length > 100) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', '一场训练最多引用 100 道不同题目')
  const requestedRevisionIds = [...new Set(stages.flatMap(stage => (stage.problems || []).map(item => item.testSetRevisionId).filter((id): id is string => Boolean(id))))]
  const [problems, requestedRevisions] = await Promise.all([
    allProblemIds.length ? prisma.problem.findMany({ where: { id: { in: allProblemIds }, latestTestSetRevisionId: { not: null }, status: { not: 'archived' }, ...(access && !access.canSeeAll ? { OR: [{ ownerId: access.userId }, { libraryScope: 'platform', status: 'published' }, ...(access.organizationId ? [{ libraryScope: 'school', organizationId: access.organizationId, status: 'published' }] : [])] } : {}) }, include: { LatestTestSetRevision: true } }) : [],
    requestedRevisionIds.length ? prisma.problemTestSetRevision.findMany({ where: { id: { in: requestedRevisionIds } } }) : [],
  ])
  const byId = new Map(problems.map(item => [item.id, item]))
  const revisionsById = new Map(requestedRevisions.map(item => [item.id, item]))
  return stages.map((stage, stageIndex) => {
    const name = boundedText(stage.name, 100, `阶段 ${stageIndex + 1} 名称`, 1)
    const mode = enumValue(stage.mode, STAGE_MODES, 'FREE', `阶段 ${stageIndex + 1} 模式`)
    const advanceMode = enumValue(stage.advanceMode, ADVANCE_MODES, 'MANUAL', `阶段 ${stageIndex + 1} 推进方式`)
    const problemAccessMode = enumValue(stage.problemAccessMode, ACCESS_MODES, 'STAGE_ONLY', `阶段 ${stageIndex + 1} 题目访问方式`)
    const submissionMode = enumValue(stage.submissionMode, SUBMISSION_MODES, 'ENABLED', `阶段 ${stageIndex + 1} 提交方式`)
    const durationSeconds = boundedInteger(stage.durationSeconds, 60, 24 * 3600, '阶段时长')
    const completionThreshold = boundedInteger(stage.completionThreshold ?? (['COMPLETION', 'HYBRID'].includes(advanceMode) ? 100 : null), 1, 100, '完成比例')
    if (['TIME', 'HYBRID'].includes(advanceMode) && !durationSeconds) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', `阶段 ${stageIndex + 1} 使用${advanceMode === 'TIME' ? '按时' : '混合'}推进时必须设置阶段时长`)
    if (['COMPLETION', 'HYBRID'].includes(advanceMode) && !completionThreshold) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', `阶段 ${stageIndex + 1} 使用${advanceMode === 'COMPLETION' ? '完成度' : '混合'}推进时必须设置完成比例`)
    const rawRules = parseJsonObject(stage.rules)
    const rules: Record<string, any> = { ...rawRules, ...(rawRules.defaultUnlock ? { defaultUnlock: normalizeUnlockPolicy(rawRules.defaultUnlock) } : {}) }
    const seen = new Set<string>()
    const stageProblems = (stage.problems || []).map((item, problemIndex) => {
      const problem = byId.get(String(item.problemId))
      if (!problem?.LatestTestSetRevision) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_REVISION_REQUIRED', `阶段 ${stageIndex + 1} 的第 ${problemIndex + 1} 道题没有正式 TestSet Revision`)
      const revision = item.testSetRevisionId ? revisionsById.get(item.testSetRevisionId) : problem.LatestTestSetRevision
      if (!revision || revision.problemId !== problem.id) throw new TrainingEngineError(422, 'TRAINING_REVISION_PROBLEM_MISMATCH', `阶段 ${stageIndex + 1} 的第 ${problemIndex + 1} 道题使用了不属于该题的 TestSet Revision`)
      if (seen.has(problem.id)) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', `阶段 ${stageIndex + 1} 重复引用同一道题`)
      seen.add(problem.id)
      const allowedSubtaskIds = Array.isArray(item.allowedSubtaskIds) ? [...new Set(item.allowedSubtaskIds.map(Number))] : []
      if (allowedSubtaskIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new TrainingEngineError(422, 'UNKNOWN_TRAINING_SUBTASK', 'Subtask ID 必须是正整数')
      if (allowedSubtaskIds.length && revision.mode !== 'oi') throw new TrainingEngineError(422, 'SUBTASK_PROJECTION_UNSUPPORTED', '仅 OI Revision 支持按 Subtask 训练')
      let projection: string | null = null
      if (allowedSubtaskIds.length) {
        const config = yaml.load(revision.judgeConfig) as any
        const available = new Set((config?.subtasks || []).map((subtask: any) => Number(subtask.id)))
        if (allowedSubtaskIds.some(id => !available.has(id))) throw new TrainingEngineError(422, 'UNKNOWN_TRAINING_SUBTASK', `训练投影包含不存在的 Subtask：${allowedSubtaskIds.filter(id => !available.has(id)).join(', ')}`)
        projection = yaml.dump({ ...config, subtasks: (config.subtasks || []).filter((subtask: any) => allowedSubtaskIds.includes(Number(subtask.id))) }, { noRefs: true, lineWidth: 120 })
      }
      return { item: {
        ...item,
        unlockPolicy: normalizeUnlockPolicy(item.unlockPolicy),
        strategyIntervalSeconds: item.strategyIntervalSeconds ?? rules.strategyIntervalSeconds,
        maxContinuousWorkSeconds: item.maxContinuousWorkSeconds ?? rules.maxContinuousWorkSeconds,
        forceSwitchOnTimeout: item.forceSwitchOnTimeout ?? rules.forceSwitchOnTimeout,
      }, problem, revision, problemIndex, allowedSubtaskIds, projection }
    })
    return { stage: { ...stage, mode, advanceMode, problemAccessMode, submissionMode, durationSeconds, completionThreshold, rules }, stageIndex, name, stageProblems }
  })
}


export async function createTrainingSession(userId: string, body: any) {
  const scope = await assertScopeManagement(userId, body || {})
  const template = getBuiltinTrainingTemplate(body?.templateKey)
  const sessionType = enumValue(body?.sessionType || template?.sessionType, SESSION_TYPES, 'GENERAL', '训练类型')
  const defaultProblemAccessMode = enumValue(body?.defaultProblemAccessMode, ACCESS_MODES, 'STAGE_ONLY', '默认题目访问方式')
  const defaultSubmissionMode = enumValue(body?.defaultSubmissionMode, SUBMISSION_MODES, 'ENABLED', '默认提交方式')
  const rankingMode = enumValue(body?.rankingMode, RANKING_MODES, 'PROGRESS_ONLY', '训练榜单方式')
  const peerVisibility = enumValue(body?.peerVisibility, PEER_VISIBILITY, 'PROGRESS', '同学状态可见性')
  const joinMode = enumValue(body?.joinMode, JOIN_MODES, 'CURRENT_STAGE', '迟到加入方式')
  const scheduledStartAt = optionalDate(body?.scheduledStartAt, '计划开始时间')
  const rawStages = Array.isArray(body?.stages) && body.stages.length ? body.stages : template?.stages || [{ name: '自由训练', mode: 'FREE', advanceMode: 'MANUAL', problems: [] }]
  const stages = rawStages.map((stage: StructureStage) => ({ ...stage, problemAccessMode: stage.problemAccessMode || defaultProblemAccessMode, submissionMode: stage.submissionMode || defaultSubmissionMode }))
  const hydrated = await hydrateStages(stages, await problemAccessContext(userId, scope.organizationId, scope.teamId))
  const title = boundedText(body?.title, 200, '训练名称', 1)
  const id = crypto.randomUUID()
  await prisma.$transaction(async tx => {
    await tx.trainingSession.create({ data: {
      id, title, description: body?.description ? boundedText(body.description, 5000, '训练说明') : null,
      sessionType: sessionType as any, ...scope, createdBy: userId,
      scheduledStartAt,
      defaultProblemAccessMode: defaultProblemAccessMode as any, defaultSubmissionMode: defaultSubmissionMode as any,
      allowHints: body?.allowHints !== false, allowSolution: Boolean(body?.allowSolution), allowDiscussion: Boolean(body?.allowDiscussion),
      rankingMode: rankingMode as any, peerVisibility: peerVisibility as any, joinMode: joinMode as any,
    } })
    // Reuse the validated structure without trusting client-side snapshots.
    for (const entry of hydrated) {
      const stage = await tx.trainingSessionStage.create({ data: { sessionId: id, name: entry.name, description: entry.stage.description?.trim() || null, orderIndex: entry.stageIndex, mode: (entry.stage.mode || 'FREE') as any, durationSeconds: boundedInteger(entry.stage.durationSeconds, 60, 86400, '阶段时长'), advanceMode: (entry.stage.advanceMode || 'MANUAL') as any, problemAccessMode: (entry.stage.problemAccessMode || 'STAGE_ONLY') as any, submissionMode: (entry.stage.submissionMode || 'ENABLED') as any, targetScore: boundedInteger(entry.stage.targetScore, 0, 100, '目标分数'), completionThreshold: boundedInteger(entry.stage.completionThreshold, 1, 100, '完成比例'), minDurationSeconds: boundedInteger(entry.stage.minDurationSeconds, 0, 86400, '最短阶段时长'), rules: asJson(entry.stage.rules) } })
      for (const item of entry.stageProblems) await tx.trainingSessionStageProblem.create({ data: { stageId: stage.id, problemId: item.problem.id, testSetRevisionId: item.revision.id, alias: item.item.alias?.trim() || null, orderIndex: item.problemIndex, unlockPolicy: asJson(item.item.unlockPolicy), targetScore: boundedInteger(item.item.targetScore, 0, 100, '题目目标分数'), timeLimitSeconds: boundedInteger(item.item.timeLimitSeconds, 60, 86400, '题目训练时长'), hintPolicy: asJson(item.item.hintPolicy), judgeConfigProjection: item.projection, allowedSubtaskIds: item.allowedSubtaskIds.length ? item.allowedSubtaskIds : undefined, strategyIntervalSeconds: boundedInteger(item.item.strategyIntervalSeconds, 60, 86400, '策略检查间隔'), maxContinuousWorkSeconds: boundedInteger(item.item.maxContinuousWorkSeconds, 60, 86400, '最长连续做题时间'), forceSwitchOnTimeout: Boolean(item.item.forceSwitchOnTimeout) } })
    }
  })
  return loadSession(id)
}

function structureIssues(stages: StructureStage[]) {
  const issues: Array<{ path: string; code: string; message: string; severity: 'error' | 'warning' }> = []
  stages.forEach((stage, stageIndex) => {
    const problems = stage.problems || []
    if (!['TEACHING', 'REVIEW'].includes(String(stage.mode || 'FREE')) && problems.length === 0) {
      issues.push({ path: `stages.${stageIndex}.problems`, code: 'STAGE_PROBLEM_REQUIRED', message: `阶段 ${stageIndex + 1} 至少需要一道题`, severity: 'error' })
    }
    if (['SEQUENTIAL'].includes(String(stage.mode)) || stage.problemAccessMode === 'SEQUENTIAL') {
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
  if (session.status !== 'DRAFT') throw new TrainingEngineError(409, 'TRAINING_STRUCTURE_FROZEN', '发布后的训练结构不能修改')
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
  const stages = session.Stages.map((stage, stageIndex) => ({
    ...stage,
    clientKey: stage.id,
    orderIndex: stageIndex,
    Problems: stage.Problems.map((problem, problemIndex) => ({
      ...problem,
      assignmentId: problem.id,
      clientKey: problem.id,
      orderIndex: problemIndex,
      latestRevision: latestByProblem.get(problem.problemId) || null,
      subtasks: subtasksByRevision.get(problem.testSetRevisionId) || [],
    })),
  }))
  const payloadStages = stages.map(stage => ({ ...stage, problems: stage.Problems })) as unknown as StructureStage[]
  return { editable: session.status === 'DRAFT', statusRevision: session.statusRevision, session: { id: session.id, title: session.title, description: session.description, sessionType: session.sessionType, status: session.status, organizationId: session.organizationId, teamId: session.teamId, scheduledStartAt: session.scheduledStartAt, rankingMode: session.rankingMode, peerVisibility: session.peerVisibility, joinMode: session.joinMode, allowHints: session.allowHints, allowSolution: session.allowSolution, allowDiscussion: session.allowDiscussion }, stages, issues: structureIssues(payloadStages) }
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
  if (session.status !== 'DRAFT') throw new TrainingEngineError(409, 'TRAINING_STRUCTURE_FROZEN', '发布后的训练结构不能覆盖，请复制为新训练')
  const expectedRevision = Number(body?.expectedRevision)
  if (expectedRevision !== session.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练已被其他管理员修改，请刷新')
  const stages = Array.isArray(body?.stages) ? body.stages as StructureStage[] : []
  const issues = structureIssues(stages)
  if (issues.some(issue => issue.severity === 'error')) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', issues.map(issue => issue.message).join('；'), { issues })
  const requestedStageIds = stages.map(stage => stage.id).filter((id): id is string => Boolean(id))
  const requestedAssignmentIdList = stages.flatMap(stage => (stage.problems || []).map(problem => problem.assignmentId).filter((id): id is string => Boolean(id)))
  const clientKeys = stages.flatMap(stage => [stage.clientKey, ...(stage.problems || []).map(problem => problem.clientKey)]).filter((key): key is string => Boolean(key))
  if (new Set(requestedStageIds).size !== requestedStageIds.length || new Set(requestedAssignmentIdList).size !== requestedAssignmentIdList.length || new Set(clientKeys).size !== clientKeys.length) throw new TrainingEngineError(422, 'INVALID_TRAINING_STRUCTURE', '阶段、题目分配或客户端草稿 key 重复')
  const hydrated = await hydrateStages(stages, await problemAccessContext(userId, session.organizationId, session.teamId))
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
    const claimed = await tx.trainingSession.updateMany({ where: { id: sessionId, statusRevision: expectedRevision, status: 'DRAFT' }, data: { statusRevision: { increment: 1 }, title: body?.title ? boundedText(body.title, 200, '训练名称', 1) : session.title, description: body?.description === undefined ? session.description : body.description ? boundedText(body.description, 5000, '训练说明') : null } })
    if (!claimed.count) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练已被其他管理员修改，请刷新')
    const existingStages = await tx.trainingSessionStage.findMany({ where: { sessionId }, include: { Problems: { include: { _count: { select: { Hints: true } } } } } })
    const stageById = new Map(existingStages.map(stage => [stage.id, stage]))
    const assignmentById = new Map(existingStages.flatMap(stage => stage.Problems.map(problem => [problem.id, { ...problem, originalStageId: stage.id }] as const)))
    for (const stage of stages) if (stage.id && !stageById.has(stage.id)) throw new TrainingEngineError(422, 'TRAINING_STAGE_NOT_FOUND', '阶段不属于当前训练')
    const requestedAssignmentIds = new Set(stages.flatMap(stage => (stage.problems || []).map(problem => problem.assignmentId).filter((id): id is string => Boolean(id))))
    for (const assignmentId of requestedAssignmentIds) if (!assignmentById.has(assignmentId)) throw new TrainingEngineError(422, 'TRAINING_ASSIGNMENT_NOT_FOUND', '题目分配不属于当前训练')
    const removedWithHints = [...assignmentById.values()].filter(item => !requestedAssignmentIds.has(item.id) && item._count.Hints > 0)
    if (removedWithHints.length && body?.confirmDependentRemoval !== true) throw new TrainingEngineError(409, 'TRAINING_STRUCTURE_REMOVAL_REQUIRES_CONFIRMATION', `将删除 ${removedWithHints.reduce((sum, item) => sum + item._count.Hints, 0)} 条关联提示，请确认后重试`)
    await tx.trainingSessionStage.updateMany({ where: { sessionId }, data: { orderIndex: { increment: 10000 } } })
    await tx.trainingSessionStageProblem.updateMany({ where: { Stage: { sessionId } }, data: { orderIndex: { increment: 10000 } } })
    const keepStageIds: string[] = []
    const keepAssignmentIds: string[] = []
    for (const entry of hydrated) {
      const requestedStageId = entry.stage.id && stageById.has(entry.stage.id) ? entry.stage.id : null
      const savedStage = requestedStageId
        ? await tx.trainingSessionStage.update({ where: { id: requestedStageId }, data: { name: entry.name, description: entry.stage.description?.trim() || null, orderIndex: entry.stageIndex, mode: entry.stage.mode as any, durationSeconds: entry.stage.durationSeconds, advanceMode: entry.stage.advanceMode as any, problemAccessMode: entry.stage.problemAccessMode as any, submissionMode: entry.stage.submissionMode as any, targetScore: boundedInteger(entry.stage.targetScore, 0, 100, '目标分数'), completionThreshold: entry.stage.completionThreshold, minDurationSeconds: boundedInteger(entry.stage.minDurationSeconds, 0, 86400, '最短阶段时长'), rules: asJson(entry.stage.rules) } })
        : await tx.trainingSessionStage.create({ data: { sessionId, name: entry.name, description: entry.stage.description?.trim() || null, orderIndex: entry.stageIndex, mode: entry.stage.mode as any, durationSeconds: entry.stage.durationSeconds, advanceMode: entry.stage.advanceMode as any, problemAccessMode: entry.stage.problemAccessMode as any, submissionMode: entry.stage.submissionMode as any, targetScore: boundedInteger(entry.stage.targetScore, 0, 100, '目标分数'), completionThreshold: entry.stage.completionThreshold, minDurationSeconds: boundedInteger(entry.stage.minDurationSeconds, 0, 86400, '最短阶段时长'), rules: asJson(entry.stage.rules) } })
      keepStageIds.push(savedStage.id)
      for (const item of entry.stageProblems) {
        const requestedAssignmentId = item.item.assignmentId && assignmentById.has(item.item.assignmentId) ? item.item.assignmentId : null
        const data = { stageId: savedStage.id, problemId: item.problem.id, testSetRevisionId: item.revision.id, alias: item.item.alias?.trim() || null, orderIndex: item.problemIndex, unlockPolicy: asJson(item.item.unlockPolicy), targetScore: boundedInteger(item.item.targetScore, 0, 100, '题目目标分数'), timeLimitSeconds: boundedInteger(item.item.timeLimitSeconds, 60, 86400, '题目训练时长'), hintPolicy: asJson(item.item.hintPolicy), judgeConfigProjection: item.projection, allowedSubtaskIds: item.allowedSubtaskIds.length ? item.allowedSubtaskIds : undefined, strategyIntervalSeconds: boundedInteger(item.item.strategyIntervalSeconds, 60, 86400, '策略检查间隔'), maxContinuousWorkSeconds: boundedInteger(item.item.maxContinuousWorkSeconds, 60, 86400, '最长连续做题时间'), forceSwitchOnTimeout: Boolean(item.item.forceSwitchOnTimeout) }
        const saved = requestedAssignmentId ? await tx.trainingSessionStageProblem.update({ where: { id: requestedAssignmentId }, data }) : await tx.trainingSessionStageProblem.create({ data })
        keepAssignmentIds.push(saved.id)
      }
    }
    await tx.trainingSessionStageProblem.deleteMany({ where: { Stage: { sessionId }, id: { notIn: keepAssignmentIds } } })
    await tx.trainingSessionStage.deleteMany({ where: { sessionId, id: { notIn: keepStageIds } } })
  })
  return loadSession(sessionId)
}

async function eligibleParticipantIds(session: { organizationId: string | null; teamId: string | null }) {
  if (session.teamId) return (await prisma.teamMember.findMany({ where: { teamId: session.teamId, status: 'active' }, select: { userId: true } })).map(item => item.userId)
  if (session.organizationId) return (await prisma.organizationMembership.findMany({ where: { organizationId: session.organizationId, status: 'active' }, select: { userId: true } })).map(item => item.userId)
  return []
}

async function appendEvent(tx: Prisma.TransactionClient, sessionId: string, type: string, targetType: TrainingEngineTargetType = 'ALL', targetId: string | null = null, payload?: unknown) {
  const session = await tx.trainingSession.update({ where: { id: sessionId }, data: { eventSeq: { increment: 1 } }, select: { eventSeq: true } })
  return tx.trainingSessionEvent.create({ data: { sessionId, seq: session.eventSeq, type, targetType, targetId, payload: asJson(payload), expiresAt: new Date(Date.now() + 7 * 24 * 3600_000) } })
}

export async function publishTrainingSession(userId: string, sessionId: string, expectedRevision: number) {
  const session = await assertManage(userId, sessionId)
  if (session.status !== 'DRAFT') throw new TrainingEngineError(409, 'TRAINING_SESSION_ALREADY_PUBLISHED', '训练已经发布')
  if (!session.Stages.length || session.Stages.some(stage => !stage.Problems.length && !['TEACHING', 'REVIEW'].includes(stage.mode))) throw new TrainingEngineError(422, 'TRAINING_STRUCTURE_INCOMPLETE', '非讲解阶段必须至少包含一道题')
  const issues = structureIssues(session.Stages.map(stage => ({ ...stage, problems: stage.Problems })) as unknown as StructureStage[])
  if (issues.some(issue => issue.severity === 'error')) throw new TrainingEngineError(422, 'TRAINING_STRUCTURE_INCOMPLETE', issues.map(issue => issue.message).join('；'))
  const assigned = await prisma.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, select: { userId: true } })
  const userIds = assigned.length ? assigned.map(item => item.userId) : await eligibleParticipantIds(session)
  await prisma.$transaction(async tx => {
    const claimed = await tx.trainingSession.updateMany({ where: { id: sessionId, status: 'DRAFT', statusRevision: expectedRevision }, data: { status: 'SCHEDULED', statusRevision: { increment: 1 }, currentStageId: session.Stages[0].id } })
    if (!claimed.count) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练已被其他管理员修改，请刷新')
    for (const participantUserId of [...new Set(userIds)]) await tx.trainingSessionParticipant.upsert({ where: { sessionId_userId: { sessionId, userId: participantUserId } }, update: { status: 'active' }, create: { sessionId, userId: participantUserId, currentStageId: session.Stages[0].id } })
    await appendEvent(tx, sessionId, 'training.session.scheduled', 'ALL', null, { scheduledStartAt: session.scheduledStartAt })
  })
  return loadSession(sessionId)
}

function targetApplies(targetType: TrainingEngineTargetType, targetId: string | null, participant: { userId: string; groupId: string | null }, session: { teamId: string | null }) {
  if (targetType === 'ALL') return true
  if (targetType === 'USER') return targetId === participant.userId
  if (targetType === 'GROUP') return targetId === participant.groupId
  if (targetType === 'TEAM') return targetId === session.teamId
  return false
}

async function normalizeCommandTarget(
  tx: Prisma.TransactionClient,
  session: { id: string; teamId: string | null },
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
    const group = await tx.trainingSessionGroup.findFirst({ where: { id: rawTargetId, sessionId: session.id }, select: { id: true } })
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
  participants: Array<{ id: string; userId: string; groupId: string | null; returnStageId: string | null; returnProblemId: string | null }>,
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
  if (condition?.type === 'TEACHER') return false
  if (condition?.type === 'AC') return Boolean(progress?.acAt) || String(progress?.bestVerdict || '').toLowerCase() === 'accepted'
  if (condition?.type === 'SCORE') return Number(progress?.bestScore || 0) >= Number(condition.value || 0)
  if (condition?.type === 'TIME') return Number(progress?.activeSeconds || 0) >= Number(condition.value || 0)
  if (condition?.type === 'ATTEMPTS') return Number(progress?.attemptCount || 0) >= Number(condition.value || 0)
  return false
}

export async function resolveTrainingPermission(userId: string, sessionId: string, stageProblemId?: string | null) {
  const session = await loadSession(sessionId)
  if (!session) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'SESSION_NOT_FOUND' }
  if (await canManageSession(userId, session)) return { canView: true, canSubmit: session.status === 'RUNNING', canEdit: true, canOpenHint: true, reason: 'ADMIN_OVERRIDE' }
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  if (!participant || participant.status !== 'active') return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'NOT_PARTICIPANT' }
  if (session.status === 'DRAFT' || session.status === 'SCHEDULED') return { canView: session.status === 'SCHEDULED', canSubmit: false, canEdit: false, canOpenHint: false, reason: 'SESSION_NOT_RUNNING' }
  if (session.status === 'ENDED' || session.status === 'ARCHIVED') return { canView: true, canSubmit: false, canEdit: false, canOpenHint: session.allowHints, reason: 'SESSION_ENDED' }
  if (session.status === 'PAUSED') return { canView: true, canSubmit: false, canEdit: session.pauseMode !== 'HARD', canOpenHint: false, reason: session.pauseMode === 'HARD' ? 'HARD_PAUSE' : 'SOFT_PAUSE' }
  if (!stageProblemId) return { canView: true, canSubmit: false, canEdit: true, canOpenHint: session.allowHints, reason: 'PROBLEM_REQUIRED' }
  const stage = session.Stages.find(item => item.id === participant.currentStageId || item.id === session.currentStageId)
  const stageProblem = session.Stages.flatMap(item => item.Problems.map(problem => ({ ...problem, stage: item }))).find(item => item.id === stageProblemId)
  if (!stage || !stageProblem) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'PROBLEM_NOT_IN_SESSION' }
  const overrides = await prisma.trainingSessionUserOverride.findMany({ where: { sessionId, userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })
  const unlocked = overrides.some(item => item.type === 'UNLOCK_PROBLEM' && (!item.stageProblemId || item.stageProblemId === stageProblemId))
  const submissionOverride = overrides.some(item => item.type === 'ENABLE_SUBMISSION')
  const overlays = session.Overlays.filter(item => targetApplies(item.targetType, item.targetId, participant, session))
  const focus = [...overlays].reverse().find(item => ['SOFT_FOCUS', 'LOCKED_FOCUS', 'EXAM_FOCUS'].includes(item.type))
  if (focus && focus.type !== 'SOFT_FOCUS' && focus.stageProblemId !== stageProblemId && !unlocked) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'FOCUS_LOCK' }
  if (overlays.some(item => item.type === 'DISABLE_SUBMISSION') && !submissionOverride) return { canView: true, canSubmit: false, canEdit: true, canOpenHint: session.allowHints, reason: 'SUBMISSION_DISABLED' }
  if (overlays.some(item => item.type === 'LOCK_PROBLEM' && item.stageProblemId === stageProblemId) && !unlocked) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'PROBLEM_LOCKED' }
  if (stage.problemAccessMode !== 'ALL' && stageProblem.stageId !== stage.id && !unlocked && focus?.stageProblemId !== stageProblemId) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'STAGE_LOCK' }
  if (stage.problemAccessMode === 'FOCUS_ONLY' && !unlocked) {
    const focusedStageProblemId = focus?.stageProblemId || participant.currentProblemId || stage.Problems[0]?.id
    if (focusedStageProblemId !== stageProblemId) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'FOCUS_REQUIRED' }
  }
  if ((stage.mode === 'SEQUENTIAL' || stage.problemAccessMode === 'SEQUENTIAL') && !unlocked) {
    const ordered = stage.Problems
    const index = ordered.findIndex(item => item.id === stageProblemId)
    if (index > 0) {
      const previous = ordered[index - 1]
      const progress = await prisma.trainingSessionProblemProgress.findUnique({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: previous.id } } })
      const policy = parseJsonObject(stageProblem.unlockPolicy || parseJsonObject(stage.rules).defaultUnlock || { mode: 'ANY', conditions: [{ type: 'AC' }] })
      const conditions = Array.isArray(policy.conditions) ? policy.conditions : [{ type: 'AC' }]
      const passed = String(policy.mode || 'ANY') === 'ALL' ? conditions.every(item => conditionSatisfied(item, progress)) : conditions.some(item => conditionSatisfied(item, progress))
      if (!passed) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'SEQUENTIAL_LOCK' }
    }
  }
  if (stageProblem.forceSwitchOnTimeout && stageProblem.maxContinuousWorkSeconds && !unlocked) {
    const progress = await prisma.trainingSessionProblemProgress.findUnique({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } } })
    if (progress && !progress.acAt && progress.continuousActiveSeconds >= stageProblem.maxContinuousWorkSeconds) {
      return { canView: true, canSubmit: false, canEdit: true, canOpenHint: session.allowHints && focus?.type !== 'EXAM_FOCUS', reason: 'FORCED_SWITCH_REQUIRED' }
    }
  }
  const canSubmit = (stage.submissionMode === 'ENABLED' && session.defaultSubmissionMode === 'ENABLED') || submissionOverride
  return { canView: true, canSubmit, canEdit: true, canOpenHint: session.allowHints && focus?.type !== 'EXAM_FOCUS', reason: canSubmit ? 'ALLOWED' : 'SUBMISSION_DISABLED' }
}

export async function joinTrainingSession(userId: string, sessionId: string) {
  const session = await loadSession(sessionId)
  if (!session || session.status === 'DRAFT' || session.status === 'ENDED' || session.status === 'ARCHIVED') throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练场次不可加入')
  const eligible = session.teamId ? await isTeamMember(userId, session.teamId) : session.organizationId ? await isOrganizationMember(userId, session.organizationId) : false
  if (!eligible) throw new TrainingEngineError(403, 'TRAINING_SESSION_FORBIDDEN', '不在该训练的成员范围内')
  const existing = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  if (existing?.status === 'active') return existing
  if (session.joinMode === 'TEACHER_ASSIGN' || parseJsonObject(session.settings).rosterExplicit === true) throw new TrainingEngineError(409, 'TRAINING_JOIN_REQUIRES_ASSIGNMENT', '该训练需要教练将你加入名单并分配阶段')
  const stageId = session.joinMode === 'FROM_BEGINNING' ? session.Stages[0]?.id : session.currentStageId || session.Stages[0]?.id
  return prisma.trainingSessionParticipant.upsert({ where: { sessionId_userId: { sessionId, userId } }, update: { status: 'active', currentStageId: stageId }, create: { sessionId, userId, currentStageId: stageId } })
}

export async function listTrainingSessions(userId: string, query: any) {
  const role = await globalRole(userId)
  if (!role || role.status !== 'active') throw new TrainingEngineError(401, 'UNAUTHENTICATED', '请先登录')
  const teamId = query?.teamId ? String(query.teamId) : null, organizationId = query?.organizationId ? String(query.organizationId) : null
  if (teamId && !await isTeamMember(userId, teamId)) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练范围不存在')
  if (organizationId && !await isOrganizationMember(userId, organizationId)) throw new TrainingEngineError(404, 'TRAINING_SESSION_NOT_FOUND', '训练范围不存在')
  const scopeManager = role.role === 'super_admin' || Boolean(teamId && await isTeamAdmin(userId, teamId)) || Boolean(organizationId && await isOrganizationContestAdmin(userId, organizationId))
  const where: Prisma.TrainingSessionWhereInput = {
    ...(teamId ? { teamId } : organizationId ? { organizationId } : {}),
    ...(!scopeManager ? { OR: [{ createdBy: userId }, { Participants: { some: { userId, status: 'active' } } }, ...((teamId || organizationId) ? [{ status: { in: ['SCHEDULED', 'RUNNING', 'PAUSED'] as any } }] : [])] } : {}),
    ...(query?.status ? { status: String(query.status).toUpperCase() as any } : {}),
  }
  const sessions = await prisma.trainingSession.findMany({ where, orderBy: [{ status: 'asc' }, { scheduledStartAt: 'desc' }, { createdAt: 'desc' }], include: { Participants: { where: { userId, status: 'active' }, select: { id: true } }, _count: { select: { Stages: true, Participants: true } } }, take: 100 })
  return sessions.filter(item => {
    if (scopeManager || item.createdBy === userId || item.Participants.length) return true
    return item.joinMode !== 'TEACHER_ASSIGN' && parseJsonObject(item.settings).rosterExplicit !== true
  }).map(({ Participants, ...item }) => ({ ...item, canJoin: !scopeManager && item.createdBy !== userId && !Participants.length }))
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
  const strategy = Object.fromEntries(session.Stages.flatMap(stage => stage.Problems).map(item => {
    const itemProgress = progressByProblem.get(item.id)
    const last = latestDecision.get(item.id)
    return [item.id, {
      intervalSeconds: item.strategyIntervalSeconds,
      maxContinuousWorkSeconds: item.maxContinuousWorkSeconds,
      forceSwitchOnTimeout: item.forceSwitchOnTimeout,
      decisionDue: Boolean(item.strategyIntervalSeconds && (itemProgress?.activeSeconds || 0) - (last?.activeSecondsAtDecision || 0) >= item.strategyIntervalSeconds),
      switchRecommended: Boolean(item.maxContinuousWorkSeconds && !itemProgress?.acAt && (itemProgress?.continuousActiveSeconds || 0) >= item.maxContinuousWorkSeconds),
      lastDecision: last ? { decision: last.decision, reason: last.reason, createdAt: last.createdAt } : null,
    }]
  }))
  const permissions = Object.fromEntries((await Promise.all(session.Stages.flatMap(stage => stage.Problems).map(async item => [item.id, await resolveTrainingPermission(userId, sessionId, item.id)] as const))))
  const visibleOverlays = manager || !participant ? session.Overlays : session.Overlays.filter(overlay => targetApplies(overlay.targetType, overlay.targetId, participant, session))
  return { session: { ...session, Overlays: visibleOverlays }, manager, participant, progress, permissions, strategy }
}

export async function replaceTrainingRoster(userId: string, sessionId: string, body: any) {
  const session = await assertManage(userId, sessionId)
  const expectedRevision = Number(body?.expectedRevision)
  if (expectedRevision !== session.statusRevision) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练名单已变化，请刷新')
  const groups = Array.isArray(body?.groups) ? body.groups : []
  const participants = Array.isArray(body?.participants) ? body.participants : []
  if (groups.length > 100 || participants.length > 5000) throw new TrainingEngineError(422, 'TRAINING_ROSTER_TOO_LARGE', '分组或学员数量超过上限')
  const eligible = new Set(await eligibleParticipantIds(session))
  const userIds: string[] = [...new Set<string>(participants.map((item: any) => String(item.userId || '')))].filter(Boolean)
  const invalid = userIds.filter(id => !eligible.has(id))
  if (invalid.length) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_OUT_OF_SCOPE', '名单中包含不属于当前学校或团队的账号')
  const normalizedGroups: Array<{ clientKey: string; name: string; orderIndex: number }> = groups.map((item: any, index: number) => ({
    clientKey: String(item.id || item.key || index),
    name: boundedText(item.name, 100, `第 ${index + 1} 个分组名称`, 1),
    orderIndex: index,
  }))
  if (new Set(normalizedGroups.map(item => item.name.toLocaleLowerCase())).size !== normalizedGroups.length) throw new TrainingEngineError(422, 'DUPLICATE_TRAINING_GROUP', '训练分组名称不能重复')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${sessionId}`}, 0)) IS NULL AS locked`
    const claimed = await tx.trainingSession.updateMany({ where: { id: sessionId, statusRevision: expectedRevision }, data: { statusRevision: { increment: 1 }, settings: asJson({ ...parseJsonObject(session.settings), rosterExplicit: true }) } })
    if (!claimed.count) throw new TrainingEngineError(409, 'TRAINING_SESSION_STALE', '训练名单已变化，请刷新')
    const oldGroups = await tx.trainingSessionGroup.findMany({ where: { sessionId } })
    const groupIdsByClientKey = new Map<string, string>()
    for (const group of normalizedGroups) {
      const existing = oldGroups.find(item => item.id === group.clientKey)
      const saved = existing
        ? await tx.trainingSessionGroup.update({ where: { id: existing.id }, data: { name: group.name, orderIndex: group.orderIndex } })
        : await tx.trainingSessionGroup.create({ data: { sessionId, name: group.name, orderIndex: group.orderIndex } })
      groupIdsByClientKey.set(group.clientKey, saved.id)
    }
    const keepGroupIds = [...groupIdsByClientKey.values()]
    await tx.trainingSessionParticipant.updateMany({ where: { sessionId, groupId: { notIn: keepGroupIds } }, data: { groupId: null } })
    if (oldGroups.length) await tx.trainingSessionGroup.deleteMany({ where: { sessionId, id: { notIn: keepGroupIds } } })
    const requested = new Set(userIds)
    await tx.trainingSessionParticipant.updateMany({ where: { sessionId, userId: { notIn: userIds }, status: 'active' }, data: { status: 'removed', groupId: null } })
    for (const item of participants) {
      const participantUserId = String(item.userId || '')
      if (!requested.has(participantUserId)) continue
      const groupId = item.groupId || item.groupKey ? groupIdsByClientKey.get(String(item.groupId || item.groupKey)) || null : null
      await tx.trainingSessionParticipant.upsert({ where: { sessionId_userId: { sessionId, userId: participantUserId } }, update: { status: 'active', groupId }, create: { sessionId, userId: participantUserId, groupId, currentStageId: session.currentStageId || session.Stages[0]?.id || null } })
    }
    await appendEvent(tx, sessionId, 'training.roster.updated', 'ALL', null, { participantCount: userIds.length, groupCount: normalizedGroups.length })
  })
  return getTrainingWorkspace(userId, sessionId)
}

export async function getTrainingRoster(userId: string, sessionId: string) {
  const session = await assertManage(userId, sessionId)
  const eligible = session.teamId
    ? await prisma.teamMember.findMany({ where: { teamId: session.teamId, status: 'active' }, include: { User: { select: { id: true, username: true, avatar: true } } }, orderBy: { joinedAt: 'asc' } })
    : await prisma.organizationMembership.findMany({ where: { organizationId: session.organizationId!, status: 'active' }, include: { User: { select: { id: true, username: true, avatar: true } }, StudentProfile: { select: { name: true } }, TeacherProfile: { select: { name: true } } }, orderBy: { createdAt: 'asc' } })
  const participants = await prisma.trainingSessionParticipant.findMany({ where: { sessionId }, select: { userId: true, status: true, groupId: true } })
  const byUser = new Map(participants.map(item => [item.userId, item]))
  return {
    revision: session.statusRevision,
    groups: session.Groups,
    candidates: eligible.map((item: any) => ({ userId: item.userId, username: item.User.username, avatar: item.User.avatar, displayName: item.StudentProfile?.name || item.TeacherProfile?.name || item.User.username, role: item.memberRole || item.role, selected: byUser.get(item.userId)?.status === 'active', groupId: byUser.get(item.userId)?.groupId || null })),
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
    targetId = await normalizeCommandTarget(tx, session, targetType, targetId)
    let nextStatus: TrainingEngineSessionStatus | undefined
    const update: Prisma.TrainingSessionUpdateInput = { statusRevision: { increment: 1 }, commandSeq: { increment: 1 } }
    if (type === 'START_SESSION') {
      if (!['SCHEDULED', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '当前状态不能开始训练')
      const at = new Date()
      nextStatus = 'RUNNING'; update.status = nextStatus; update.startedAt = current.startedAt || at; update.runningSince = at; update.pausedAt = null
      const first = session.Stages.find(stage => stage.id === current.currentStageId) || session.Stages[0]
      if (!first) throw new TrainingEngineError(422, 'TRAINING_STRUCTURE_INCOMPLETE', '训练没有阶段')
      update.currentStageId = first.id
      await tx.trainingSessionStage.update({ where: { id: first.id }, data: { status: 'running', startedAt: first.startedAt || new Date() } })
    } else if (type === 'PAUSE_SESSION') {
      if (current.status !== 'RUNNING') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有进行中的训练可以暂停')
      const at = new Date()
      nextStatus = 'PAUSED'; update.status = nextStatus; update.pausedAt = at; update.runningSince = null; update.pauseMode = payload.mode === 'HARD' ? 'HARD' : 'SOFT'
      if (current.runningSince) update.activeElapsedSeconds = { increment: Math.max(0, Math.floor((at.getTime() - current.runningSince.getTime()) / 1000)) }
    } else if (type === 'RESUME_SESSION') {
      if (current.status !== 'PAUSED') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有暂停中的训练可以恢复')
      nextStatus = 'RUNNING'; update.status = nextStatus; update.pausedAt = null; update.runningSince = new Date(); update.pauseMode = null
      if (current.pausedAt && current.currentStageId) {
        const stage = await tx.trainingSessionStage.findUnique({ where: { id: current.currentStageId } })
        if (stage?.startedAt) await tx.trainingSessionStage.update({ where: { id: stage.id }, data: { startedAt: new Date(stage.startedAt.getTime() + (Date.now() - current.pausedAt.getTime())) } })
      }
    } else if (type === 'END_SESSION') {
      if (!['RUNNING', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '当前状态不能结束训练')
      const at = new Date()
      nextStatus = 'ENDED'; update.status = nextStatus; update.endedAt = at; update.pausedAt = null; update.runningSince = null; update.pauseMode = null
      if (current.status === 'RUNNING' && current.runningSince) update.activeElapsedSeconds = { increment: Math.max(0, Math.floor((at.getTime() - current.runningSince.getTime()) / 1000)) }
      await tx.trainingSessionOverlay.updateMany({ where: { sessionId, status: 'active' }, data: { status: 'ended', endedAt: new Date() } })
    } else if (type === 'ADVANCE_STAGE' || type === 'BACK_STAGE') {
      if (!['RUNNING', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '当前状态不能切换训练阶段')
      const index = session.Stages.findIndex(stage => stage.id === current.currentStageId)
      const next = session.Stages[index + (type === 'ADVANCE_STAGE' ? 1 : -1)]
      if (!next) throw new TrainingEngineError(409, 'TRAINING_STAGE_BOUNDARY', '没有可切换的训练阶段')
      if (session.Stages[index]) await tx.trainingSessionStage.update({ where: { id: session.Stages[index].id }, data: { status: 'completed', endedAt: new Date() } })
      await tx.trainingSessionStage.update({ where: { id: next.id }, data: { status: 'running', startedAt: next.startedAt || new Date(), endedAt: null } })
      update.currentStageId = next.id
      await tx.trainingSessionParticipant.updateMany({ where: { sessionId, status: 'active', currentStageId: session.Stages[index]?.id }, data: { currentStageId: next.id } })
    } else if (type === 'FOCUS_PROBLEM') {
      if (current.status !== 'RUNNING') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有进行中的训练可以聚焦题目')
      const stageProblemId = String(payload.stageProblemId || '')
      if (!session.Stages.some(stage => stage.Problems.some(problem => problem.id === stageProblemId))) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_FOUND', '聚焦题目不属于当前训练')
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
      if (type === 'SHOW_MESSAGE') {
        payload.message = boundedText(payload.message, 2000, '教练消息', 1)
        payload.messageType = ['INFO', 'WARNING', 'INSTRUCTION', 'COUNTDOWN'].includes(String(payload.messageType || '').toUpperCase()) ? String(payload.messageType).toUpperCase() : 'INFO'
      }
      await tx.trainingSessionOverlay.create({ data: { sessionId, type: type === 'SHOW_MESSAGE' ? 'MESSAGE' : type, targetType, targetId, stageProblemId: payload.stageProblemId ? String(payload.stageProblemId) : null, payload: asJson(payload), expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null, createdBy: userId } })
    } else if (type === 'ENABLE_SUBMISSION' || type === 'UNLOCK_PROBLEM' || type === 'CLEAR_MESSAGE') {
      const endingType = type === 'ENABLE_SUBMISSION' ? 'DISABLE_SUBMISSION' : type === 'UNLOCK_PROBLEM' ? 'LOCK_PROBLEM' : 'MESSAGE'
      await tx.trainingSessionOverlay.updateMany({ where: { sessionId, status: 'active', type: endingType, ...sameOverlayTarget(targetType, targetId), ...(payload.stageProblemId ? { stageProblemId: String(payload.stageProblemId) } : {}) }, data: { status: 'ended', endedAt: new Date() } })
    } else if (type === 'EXTEND_TIME') {
      const seconds = boundedInteger(payload.seconds, 60, 24 * 3600, '延长时间', false)!
      const stageId = String(payload.stageId || current.currentStageId || '')
      const stage = await tx.trainingSessionStage.findFirst({ where: { id: stageId, sessionId } })
      if (!stage) throw new TrainingEngineError(422, 'TRAINING_STAGE_NOT_FOUND', '阶段不存在')
      await tx.trainingSessionStage.update({ where: { id: stage.id }, data: { durationSeconds: (stage.durationSeconds || 0) + seconds } })
    } else if (type === 'UNLOCK_FOR_USER' || type === 'SKIP_FOR_USER') {
      if (targetType !== 'USER' || !targetId) throw new TrainingEngineError(422, 'TRAINING_COMMAND_TARGET_REQUIRED', '个人干预必须指定用户')
      const participant = await tx.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId: targetId } } })
      if (!participant) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_NOT_FOUND', '学员不在当前训练')
      if (payload.stageProblemId && !session.Stages.some(stage => stage.Problems.some(problem => problem.id === String(payload.stageProblemId)))) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
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

export async function saveTrainingDraft(userId: string, sessionId: string, problemId: string, body: any) {
  const session = await assertAccess(userId, sessionId)
  const stageProblems = session.Stages.flatMap(stage => stage.Problems).filter(item => item.problemId === problemId)
  if (!stageProblems.length) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '题目不属于当前训练')
  if (!await canManageSession(userId, session)) {
    const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
    const stageProblem = stageProblems.find(item => item.id === participant?.currentProblemId)
      || stageProblems.find(item => item.stageId === participant?.currentStageId)
      || stageProblems[0]
    const permission = await resolveTrainingPermission(userId, sessionId, stageProblem.id)
    if (!permission.canEdit) throw new TrainingEngineError(403, permission.reason, '当前训练规则不允许编辑代码草稿')
  }
  const code = String(body?.code ?? '')
  if (Buffer.byteLength(code, 'utf8') > 1024 * 1024) throw new TrainingEngineError(413, 'TRAINING_DRAFT_TOO_LARGE', '代码草稿不能超过 1 MiB')
  const existing = await prisma.trainingSessionProblemDraft.findUnique({ where: { sessionId_userId_problemId: { sessionId, userId, problemId } } })
  if (existing && body?.expectedRevision !== undefined && Number(body.expectedRevision) !== existing.revision) throw new TrainingEngineError(409, 'TRAINING_DRAFT_STALE', '草稿已在另一页面更新')
  return prisma.trainingSessionProblemDraft.upsert({ where: { sessionId_userId_problemId: { sessionId, userId, problemId } }, update: { language: String(body?.language || existing?.language || 'cpp17'), code, inputFilename: body?.inputFilename || null, outputFilename: body?.outputFilename || null, editorFocused: Boolean(body?.editorFocused), revision: { increment: 1 } }, create: { sessionId, userId, problemId, language: String(body?.language || 'cpp17'), code, inputFilename: body?.inputFilename || null, outputFilename: body?.outputFilename || null, editorFocused: Boolean(body?.editorFocused) } })
}

export async function getTrainingDraft(userId: string, sessionId: string, problemId: string) {
  await assertAccess(userId, sessionId)
  return prisma.trainingSessionProblemDraft.findUnique({ where: { sessionId_userId_problemId: { sessionId, userId, problemId } } })
}

export async function recordHeartbeat(userId: string, sessionId: string, body: any) {
  const session = await assertAccess(userId, sessionId)
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  if (!participant) throw new TrainingEngineError(403, 'TRAINING_PARTICIPANT_REQUIRED', '需要先加入训练')
  const stageProblemId = body?.stageProblemId ? String(body.stageProblemId) : null
  if (!stageProblemId) throw new TrainingEngineError(422, 'TRAINING_PROBLEM_REQUIRED', '请选择当前题目')
  const permission = await resolveTrainingPermission(userId, sessionId, stageProblemId)
  if (!permission.canView) throw new TrainingEngineError(403, permission.reason, '当前题目尚未开放')
  const now = new Date(), previous = participant.lastHeartbeatAt?.getTime() || now.getTime()
  const elapsed = session.status === 'RUNNING' && body?.pageVisible && body?.editorFocused ? Math.min(30, Math.max(0, Math.floor((now.getTime() - previous) / 1000))) : 0
  return prisma.$transaction(async tx => {
    const updatedParticipant = await tx.trainingSessionParticipant.update({ where: { id: participant.id }, data: { lastHeartbeatAt: now, activeSeconds: { increment: elapsed }, currentProblemId: stageProblemId } })
    const existing = await tx.trainingSessionProblemProgress.findUnique({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } } })
    const preservedStatus = existing && ['COMPLETED', 'SKIPPED', 'STUCK'].includes(existing.status) ? existing.status : 'WORKING'
    const switchedProblem = Boolean(participant.currentProblemId && participant.currentProblemId !== stageProblemId)
    const current = await tx.trainingSessionProblemProgress.upsert({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } }, update: { lastOpenedAt: now, activeSeconds: { increment: elapsed }, continuousActiveSeconds: switchedProblem ? elapsed : { increment: elapsed }, lastProgressAt: now, status: preservedStatus }, create: { participantId: participant.id, stageProblemId, status: 'WORKING', firstOpenedAt: now, lastOpenedAt: now, activeSeconds: elapsed, continuousActiveSeconds: elapsed, lastProgressAt: now } })
    const terminal = ['COMPLETED', 'SKIPPED'].includes(current.status)
    const stuck = !terminal && current.activeSeconds >= 1800 && current.attemptCount >= 3 && (!current.lastScoreImprovedAt || now.getTime() - current.lastScoreImprovedAt.getTime() >= 15 * 60_000)
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
  const configText = stageProblem.judgeConfigProjection || (await prisma.problemTestSetRevision.findUniqueOrThrow({ where: { id: stageProblem.testSetRevisionId }, select: { judgeConfig: true } })).judgeConfig
  const config = yaml.load(configText) as any
  const io = normalizeSubmissionIo({ inputFilename: body?.inputFilename, outputFilename: body?.outputFilename, problemType: config?.type })
  const revision = await prisma.problemTestSetRevision.findUniqueOrThrow({ where: { id: stageProblem.testSetRevisionId } })
  return createQueuedSubmissionWithRun({ userId, workspaceScope: session.organizationId ? 'campus' : 'personal', organizationId: session.organizationId, oj: stageProblem.Problem.platform, problemId: stageProblem.Problem.problemId, language, code, codeLength: Buffer.byteLength(code, 'utf8'), result: 'queuing', submitMethod: 'local', problemInternalId: stageProblem.problemId, submitScope: 'training_engine', trainingSessionId: sessionId, trainingStageProblemId: stageProblemId, testSetRevisionId: revision.id, judgeConfigHash: crypto.createHash('sha256').update(configText).digest('hex'), judgeConfigSnapshot: configText, ...io, isGlobalVisible: true }, { requestedBy: userId })
}

export async function createTrainingHint(userId: string, sessionId: string, body: any) {
  await assertManage(userId, sessionId)
  const stageProblemId = String(body?.stageProblemId || '')
  const belongs = await prisma.trainingSessionStageProblem.findFirst({ where: { id: stageProblemId, Stage: { sessionId } } })
  if (!belongs) throw new TrainingEngineError(404, 'TRAINING_PROBLEM_NOT_FOUND', '训练题目不存在')
  const level = boundedInteger(body?.level, 1, 20, '提示级别', false)!
  const openMode = enumValue(body?.openMode, HINT_OPEN_MODES, 'MANUAL', '提示开放方式')
  const triggerSeconds = boundedInteger(body?.triggerSeconds, 60, 86400, '触发时间')
  const triggerAttempts = boundedInteger(body?.triggerAttempts, 1, 100, '触发提交数')
  const triggerScore = boundedInteger(body?.triggerScore, 0, 100, '触发分数')
  if ((openMode === 'TIME' && triggerSeconds === null) || (openMode === 'ATTEMPT' && triggerAttempts === null) || (openMode === 'SCORE' && triggerScore === null)) throw new TrainingEngineError(422, 'TRAINING_HINT_TRIGGER_REQUIRED', '自动开放提示必须设置对应触发条件')
  if (await prisma.trainingSessionHint.findUnique({ where: { stageProblemId_level: { stageProblemId, level } }, select: { id: true } })) throw new TrainingEngineError(409, 'TRAINING_HINT_LEVEL_EXISTS', '当前题目已存在相同级别的提示')
  return prisma.trainingSessionHint.create({ data: { sessionId, stageProblemId, level, title: body?.title ? boundedText(body.title, 100, '提示标题') : null, content: boundedText(body?.content, 5000, '提示内容', 1), openMode: openMode as any, triggerSeconds, triggerAttempts, triggerScore, createdBy: userId } })
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
        const at = new Date()
        await tx.trainingSession.update({ where: { id: session.id }, data: { status: 'RUNNING', startedAt: at, runningSince: at, currentStageId: session.Stages[0].id, statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
        await tx.trainingSessionStage.update({ where: { id: session.Stages[0].id }, data: { status: 'running', startedAt: at } })
        await appendEvent(tx, session.id, 'training.session.started', 'ALL', null, { automatic: true })
        started++
      })
    } catch { /* another worker or command won the state transition */ }
  }
  const running = await prisma.trainingSession.findMany({ where: { status: 'RUNNING', currentStageId: { not: null } }, include: { Stages: { orderBy: { orderIndex: 'asc' } }, Participants: { where: { status: 'active' }, include: { Progress: true } } }, take: 100 })
  for (const session of running) {
    const index = session.Stages.findIndex(stage => stage.id === session.currentStageId)
    const stage = session.Stages[index]
    if (!stage || stage.advanceMode === 'MANUAL') continue
    const elapsed = stage.startedAt ? Math.max(0, Math.floor((now.getTime() - stage.startedAt.getTime()) / 1000)) : 0
    const timeReady = Boolean(stage.durationSeconds && elapsed >= stage.durationSeconds)
    const stageProblemIds = await prisma.trainingSessionStageProblem.findMany({ where: { stageId: stage.id }, select: { id: true } }).then(rows => new Set(rows.map(row => row.id)))
    const completed = session.Participants.filter(participant => {
      const relevant = participant.Progress.filter(progress => stageProblemIds.has(progress.stageProblemId))
      return relevant.length > 0 && relevant.every(progress => ['COMPLETED', 'SKIPPED'].includes(progress.status))
    }).length
    const completionRate = session.Participants.length ? Math.floor(completed * 100 / session.Participants.length) : 0
    const completionReady = Boolean(stage.completionThreshold && completionRate >= stage.completionThreshold && elapsed >= (stage.minDurationSeconds || 0))
    const due = stage.advanceMode === 'TIME' ? timeReady : stage.advanceMode === 'COMPLETION' ? completionReady : timeReady && completionReady
    if (!due) continue
    try {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`training-session:${session.id}`}, 0)) IS NULL AS locked`
        const current = await tx.trainingSession.findUnique({ where: { id: session.id } })
        if (!current || current.status !== 'RUNNING' || current.currentStageId !== stage.id) return
        const next = session.Stages[index + 1]
        const at = new Date()
        await tx.trainingSessionStage.update({ where: { id: stage.id }, data: { status: 'completed', endedAt: at } })
        if (next) {
          await tx.trainingSessionStage.update({ where: { id: next.id }, data: { status: 'running', startedAt: at, endedAt: null } })
          await tx.trainingSession.update({ where: { id: session.id }, data: { currentStageId: next.id, statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
          await tx.trainingSessionParticipant.updateMany({ where: { sessionId: session.id, status: 'active', currentStageId: stage.id }, data: { currentStageId: next.id } })
          await appendEvent(tx, session.id, 'training.stage.advanced', 'ALL', null, { fromStageId: stage.id, toStageId: next.id, automatic: true, completionRate })
          advanced++
        } else {
          const runningSeconds = current.runningSince ? Math.max(0, Math.floor((at.getTime() - current.runningSince.getTime()) / 1000)) : 0
          await tx.trainingSession.update({ where: { id: session.id }, data: { status: 'ENDED', endedAt: at, runningSince: null, activeElapsedSeconds: { increment: runningSeconds }, statusRevision: { increment: 1 }, commandSeq: { increment: 1 } } })
          await appendEvent(tx, session.id, 'training.session.ended', 'ALL', null, { automatic: true, completionRate })
          ended++
        }
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
  const participants = await prisma.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' }, include: { User: { select: { id: true, username: true, avatar: true } }, Progress: { include: { StageProblem: { include: { Problem: { select: { title: true, problemId: true } } } } } } } })
  const now = Date.now()
  return { session: { id: session.id, title: session.title, status: session.status, currentStageId: session.currentStageId }, participants: participants.map(item => ({ id: item.id, user: item.User, currentStageId: item.currentStageId, currentProblemId: item.currentProblemId, activeSeconds: item.activeSeconds, online: Boolean(item.lastHeartbeatAt && now - item.lastHeartbeatAt.getTime() < 90_000), progress: item.Progress.map(progress => ({ ...progress, code: undefined })) })), summary: { total: participants.length, working: participants.filter(item => item.Progress.some(progress => progress.status === 'WORKING')).length, stuck: participants.filter(item => item.Progress.some(progress => progress.status === 'STUCK')).length, completed: participants.filter(item => item.Progress.length > 0 && item.Progress.every(progress => ['COMPLETED', 'SKIPPED'].includes(progress.status))).length } }
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
  const visibility = manager ? 'FULL' : session.peerVisibility
  const effectiveRanking = visibility === 'PROGRESS'
    ? (session.rankingMode === 'OFF' ? 'OFF' : 'PROGRESS_ONLY')
    : visibility === 'SCORE' && session.rankingMode === 'ACM_RANKING' ? 'SCORE' : session.rankingMode
  const rows = participants.map(participant => {
    const completed = participant.Progress.filter(progress => progress.status === 'COMPLETED').length
    const score = participant.Progress.reduce((sum, progress) => sum + (progress.bestScore || 0), 0)
    const attempts = participant.Progress.reduce((sum, progress) => sum + progress.attemptCount, 0)
    const base: Record<string, unknown> = { user: participant.User, completed, total: session.Stages.reduce((sum, stage) => sum + stage.Problems.length, 0) }
    if (['SCORE', 'FULL'].includes(visibility)) base.score = score
    if (visibility === 'FULL') {
      base.attempts = attempts
      base.activeSeconds = participant.activeSeconds
      base.currentProblem = participant.Progress.find(progress => progress.stageProblemId === participant.currentProblemId)?.StageProblem || null
      base.progress = participant.Progress.map(progress => ({ stageProblemId: progress.stageProblemId, status: progress.status, bestScore: progress.bestScore, attemptCount: progress.attemptCount, activeSeconds: progress.activeSeconds, hintCount: progress.hintCount }))
    }
    return { base, completed, score, attempts, username: participant.User.username }
  })
  if (effectiveRanking !== 'OFF') rows.sort((left, right) => effectiveRanking === 'PROGRESS_ONLY'
    ? right.completed - left.completed || left.username.localeCompare(right.username)
    : effectiveRanking === 'SCORE'
      ? right.score - left.score || right.completed - left.completed || left.username.localeCompare(right.username)
      : right.completed - left.completed || left.attempts - right.attempts || left.username.localeCompare(right.username))
  else rows.sort((left, right) => left.username.localeCompare(right.username))
  return { rankingMode: effectiveRanking, peerVisibility: visibility, entries: rows.map((row, index) => ({ ...(effectiveRanking === 'OFF' ? {} : { rank: index + 1 }), ...row.base })) }
}

export async function getTrainingReport(userId: string, sessionId: string) {
  const session = await assertAccess(userId, sessionId)
  const manager = await canManageSession(userId, session)
  const where = manager ? { sessionId } : { sessionId, userId }
  const participants = await prisma.trainingSessionParticipant.findMany({ where, include: { User: { select: { id: true, username: true } }, Progress: { include: { StageProblem: { include: { Problem: { select: { title: true, problemId: true } } } } } }, ScoreEvents: { orderBy: { createdAt: 'asc' } } } })
  return participants.map(item => ({ user: item.User, activeSeconds: item.activeSeconds, problems: item.Progress.map(progress => ({ title: progress.StageProblem.Problem.title, problemId: progress.StageProblem.Problem.problemId, status: progress.status, activeSeconds: progress.activeSeconds, attemptCount: progress.attemptCount, bestScore: progress.bestScore, bestVerdict: progress.bestVerdict, hintCount: progress.hintCount, highestHintLevel: progress.highestHintLevel, stuckDetectedAt: progress.stuckDetectedAt, scoreProgression: item.ScoreEvents.filter(event => event.stageProblemId === progress.stageProblemId).map(event => ({ score: event.score, verdict: event.verdict, at: event.createdAt })) })) }))
}

export async function listTrainingEvents(userId: string, sessionId: string, afterSeq: number) {
  const session = await assertAccess(userId, sessionId)
  const participant = await prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } })
  const events = await prisma.trainingSessionEvent.findMany({ where: { sessionId, seq: { gt: Math.max(0, afterSeq) } }, orderBy: { seq: 'asc' }, take: 200 })
  return events.filter(event => !participant || targetApplies(event.targetType, event.targetId, participant, session))
}

async function advanceFromBeginningParticipant(
  tx: Prisma.TransactionClient,
  sessionId: string,
  participantId: string,
  userId: string,
  completedStageId: string,
) {
  const session = await tx.trainingSession.findUnique({
    where: { id: sessionId },
    select: {
      joinMode: true,
      currentStageId: true,
      Stages: {
        orderBy: { orderIndex: 'asc' },
        select: { id: true, orderIndex: true, Problems: { select: { id: true } } },
      },
    },
  })
  if (!session || session.joinMode !== 'FROM_BEGINNING') return
  const participant = await tx.trainingSessionParticipant.findUnique({
    where: { id: participantId },
    select: { currentStageId: true },
  })
  if (participant?.currentStageId !== completedStageId) return
  const currentIndex = session.Stages.findIndex(stage => stage.id === completedStageId)
  const globalIndex = session.Stages.findIndex(stage => stage.id === session.currentStageId)
  const next = session.Stages[currentIndex + 1]
  if (currentIndex < 0 || !next || globalIndex < currentIndex + 1) return
  const current = session.Stages[currentIndex]
  if (!current.Problems.length) return
  const completed = await tx.trainingSessionProblemProgress.count({
    where: {
      participantId,
      stageProblemId: { in: current.Problems.map(problem => problem.id) },
      status: { in: ['COMPLETED', 'SKIPPED'] },
    },
  })
  if (completed !== current.Problems.length) return
  await tx.trainingSessionParticipant.update({
    where: { id: participantId },
    data: { currentStageId: next.id, currentProblemId: null },
  })
  await appendEvent(tx, sessionId, 'training.participant.stage.advanced', 'USER', userId, {
    fromStageId: current.id,
    toStageId: next.id,
    joinMode: 'FROM_BEGINNING',
  })
}

export async function syncTrainingEngineSubmission(submission: { id: number; userId: string; trainingSessionId: string | null; trainingStageProblemId: string | null; result: string | null; score: number | null }) {
  if (!submission.trainingSessionId || !submission.trainingStageProblemId) return
  const [participant, stageProblem] = await Promise.all([
    prisma.trainingSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId: submission.trainingSessionId, userId: submission.userId } } }),
    prisma.trainingSessionStageProblem.findUnique({ where: { id: submission.trainingStageProblemId }, include: { Stage: { select: { sessionId: true, targetScore: true } } } }),
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
    const targetScore = stageProblem.targetScore ?? stageProblem.Stage.targetScore ?? 100
    const completed = accepted || bestScore >= targetScore
    await tx.trainingSessionProblemProgress.upsert({ where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId: submission.trainingStageProblemId! } }, update: { attemptCount: { increment: 1 }, bestScore, bestVerdict: accepted || improved ? submission.result : existing?.bestVerdict, acAt: accepted ? existing?.acAt || new Date() : existing?.acAt, lastSubmissionAt: new Date(), lastScoreImprovedAt: improved ? new Date() : existing?.lastScoreImprovedAt, lastProgressAt: improved ? new Date() : existing?.lastProgressAt, status: completed ? 'COMPLETED' : 'WORKING', stuckDetectedAt: improved || completed ? null : existing?.stuckDetectedAt }, create: { participantId: participant.id, stageProblemId: submission.trainingStageProblemId!, attemptCount: 1, bestScore, bestVerdict: submission.result, acAt: accepted ? new Date() : null, lastSubmissionAt: new Date(), lastScoreImprovedAt: new Date(), lastProgressAt: new Date(), status: completed ? 'COMPLETED' : 'WORKING' } })
    await tx.trainingSessionScoreEvent.create({ data: { sessionId: submission.trainingSessionId!, participantId: participant.id, stageProblemId: submission.trainingStageProblemId!, submissionId: submission.id, score: submission.score, verdict: submission.result } })
    await appendEvent(tx, submission.trainingSessionId!, 'training.progress.updated', 'USER', submission.userId, { stageProblemId: submission.trainingStageProblemId, score: submission.score, verdict: submission.result })
    if (completed) await advanceFromBeginningParticipant(tx, submission.trainingSessionId!, participant.id, submission.userId, stageProblem.stageId)
  })
}
