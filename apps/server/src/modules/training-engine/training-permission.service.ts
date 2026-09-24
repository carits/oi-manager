import type { TrainingEngineTargetType } from '@prisma/client'
import {
  evaluateProblemTimePolicy,
  normalizeTrainingAccessScope,
  resolveEffectiveTrainingRule,
} from './domain/training-rule-engine'

export type TrainingPermissionResult = {
  canView: boolean
  canSubmit: boolean
  canEdit: boolean
  canOpenHint: boolean
  reason: string
}

type PermissionPlan = {
  groupId: string | null
  orderIndex: number
  stageProblemId: string
  unlockPolicy?: unknown
  timePolicy?: unknown
  scoreGoals?: unknown
  targetScore?: number | null
  stuckPolicy?: unknown
  hintPolicy?: unknown
  rules?: unknown
}

type PermissionProblem = {
  id: string
  Plans: PermissionPlan[]
}

type PermissionGroup = {
  id: string
  accessPolicy?: unknown
  submissionMode?: unknown
  rules?: unknown
}

type PermissionStage = {
  id: string
  orderIndex: number
  audienceMode: string
  accessPolicy?: unknown
  submissionMode?: unknown
  kind?: unknown
  endPolicy?: unknown
  defaultTargetScore?: unknown
  rules?: unknown
  ParticipantAssignments: Array<{ participantId: string; groupId: string | null }>
  Groups: PermissionGroup[]
  Problems: PermissionProblem[]
}

export type PermissionSession = {
  id: string
  teamId: string | null
  status: string
  pauseMode?: string | null
  currentStageId?: string | null
  allowHints: boolean
  defaultSubmissionMode: string
  Stages: PermissionStage[]
  Overlays: Array<{
    targetType: TrainingEngineTargetType
    targetId: string | null
    type: string
    stageProblemId?: string | null
  }>
}

export type TrainingPermissionContext = {
  session: PermissionSession
  manager: boolean
  participant: any
  overrides: any[]
  progressByProblem: Map<string, any>
}

function parseJsonObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

export function targetApplies(
  targetType: TrainingEngineTargetType,
  targetId: string | null,
  participant: { id?: string; userId: string; currentGroupId?: string | null },
  session: {
    teamId: string | null
    currentStageId?: string | null
    Stages?: Array<{ id: string; ParticipantAssignments?: Array<{ participantId: string; groupId: string | null }> }>
  },
) {
  if (targetType === 'ALL') return true
  if (targetType === 'USER') return targetId === participant.userId
  if (targetType === 'GROUP') {
    const assignment = session.Stages?.find(stage => stage.id === session.currentStageId)
      ?.ParticipantAssignments?.find(item => item.participantId === participant.id)
    return targetId === (participant.currentGroupId ?? assignment?.groupId ?? null)
  }
  if (targetType === 'TEAM') return targetId === session.teamId
  return false
}

export function conditionSatisfied(condition: any, progress: any) {
  if (progress?.status === 'SKIPPED') return true
  if (condition?.type === 'TEACHER') return false
  if (condition?.type === 'AC') return Boolean(progress?.acAt) || String(progress?.bestVerdict || '').toLowerCase() === 'accepted'
  if (condition?.type === 'SCORE') return Number(progress?.bestScore || 0) >= Number(condition.value || 0)
  if (condition?.type === 'TIME') return Number(progress?.activeSeconds || 0) >= Number(condition.value || 0)
  if (condition?.type === 'ATTEMPTS') return Number(progress?.attemptCount || 0) >= Number(condition.value || 0)
  return false
}

export function resolveTrainingPermissionFromContext(
  context: TrainingPermissionContext,
  stageProblemId: string | null | undefined,
): TrainingPermissionResult {
  return resolveTrainingPermissionLoaded(
    context.session,
    context.manager,
    context.participant,
    stageProblemId,
    context.overrides,
    context.progressByProblem,
  )
}

export function resolveAllTrainingPermissions(context: TrainingPermissionContext) {
  return Object.fromEntries(
    context.session.Stages.flatMap(stage => stage.Problems).map(problem => [
      problem.id,
      resolveTrainingPermissionFromContext(context, problem.id),
    ]),
  ) as Record<string, TrainingPermissionResult>
}

export function resolveTrainingPermissionLoaded(
  session: PermissionSession,
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
  const submissionDisabled = overlays.some(item => item.type === 'DISABLE_SUBMISSION')
  const runtimeOverride = {
    ...(submissionOverride ? { submissionPolicy: 'ENABLED' } : submissionDisabled ? { submissionPolicy: 'DISABLED' } : {}),
  }
  const effectiveRule = resolveEffectiveTrainingRule({ stage, group, plan, runtimeOverride })
  const accessPolicy = effectiveRule.problemAccessPolicy

  if (accessPolicy === 'TEACHER_CONTROLLED' && !unlocked) {
    const focusedStageProblemId = focus?.stageProblemId || participant.currentProblemId || stage.Problems[0]?.id
    if (focusedStageProblemId !== stageProblemId) return { canView: false, canSubmit: false, canEdit: false, canOpenHint: false, reason: 'FOCUS_REQUIRED' }
  }

  if (accessPolicy === 'SEQUENTIAL' && !unlocked) {
    const groupId = stage.audienceMode === 'GROUPED' ? assignment?.groupId || null : null
    const ordered = stage.Problems.flatMap(problem => problem.Plans.map(item => ({ ...item, problem })))
      .filter(item => item.groupId === groupId)
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
  return {
    canView: true,
    canSubmit,
    canEdit: true,
    canOpenHint: session.allowHints && effectiveRule.hintPolicy.enabled && focus?.type !== 'EXAM_FOCUS',
    reason: canSubmit ? 'ALLOWED' : 'SUBMISSION_DISABLED',
  }
}
