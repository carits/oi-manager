export type TrainingStagePurpose = 'TRAINING' | 'TEACHING' | 'REVIEW'
export type TrainingProblemAccessPolicy = 'ALL_AT_ONCE' | 'SEQUENTIAL' | 'TEACHER_CONTROLLED'
export type TrainingAccessScope = 'CURRENT_STAGE' | 'PREVIOUS_AND_CURRENT' | 'SESSION_ALL'
export type TrainingSubmissionPolicy = 'ENABLED' | 'DISABLED'
export type TrainingProblemTimeAction = 'REMIND' | 'RECOMMEND_SWITCH' | 'LOCK_SUBMISSION' | 'FORCE_SWITCH'
export type TrainingScorePolicyType = 'AC' | 'TARGET_SCORE' | 'PROGRESSIVE'

export type TrainingProblemTimePolicy =
  | { type: 'NONE' }
  | { type: 'PROBLEM_LIMIT'; limitSeconds: number; action: TrainingProblemTimeAction }

export type TrainingScorePolicy =
  | { type: 'AC'; completionScore: 100; targets: number[] }
  | { type: 'TARGET_SCORE'; completionScore: number; targets: number[] }
  | { type: 'PROGRESSIVE'; completionScore: number; targets: number[] }

export type TrainingHintPolicy = {
  enabled: boolean
  mode?: 'MANUAL' | 'TIME' | 'ATTEMPT' | 'SCORE'
  triggerSeconds?: number
  triggerAttempts?: number
  triggerScore?: number
}

export type TrainingStuckPolicy = {
  minActiveSeconds: number
  minAttempts: number
  noImprovementSeconds: number
}

export type EffectiveTrainingRule = {
  purpose: TrainingStagePurpose
  problemAccessPolicy: TrainingProblemAccessPolicy
  accessScope: TrainingAccessScope
  timePolicy: TrainingProblemTimePolicy
  scorePolicy: TrainingScorePolicy
  submissionPolicy: TrainingSubmissionPolicy
  hintPolicy: TrainingHintPolicy
  endPolicy: 'MANUAL' | 'TIME' | 'COMPLETION' | 'HYBRID'
  stuckPolicy: TrainingStuckPolicy
}

type RuleSource = Record<string, unknown> | null | undefined

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function finiteInt(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

function normalizeTargets(value: unknown): number[] {
  const rows = Array.isArray(value) ? value : []
  const scores = rows
    .map(item => typeof item === 'number' ? item : Number(record(item).score))
    .filter(score => Number.isInteger(score) && score >= 0 && score <= 100)
  return [...new Set(scores)].sort((a, b) => a - b)
}

export function normalizeTrainingAccessScope(value: unknown): TrainingAccessScope {
  const normalized = String(value || 'CURRENT_STAGE').toUpperCase()
  if (normalized === 'PREVIOUS_AND_CURRENT' || normalized === 'SESSION_ALL') return normalized
  return 'CURRENT_STAGE'
}

export function normalizeTrainingProblemTimePolicy(value: unknown): TrainingProblemTimePolicy {
  const source = record(value)
  const explicitAction = String(source.action || '').toUpperCase()
  if (['REMIND', 'RECOMMEND_SWITCH', 'LOCK_SUBMISSION', 'FORCE_SWITCH'].includes(explicitAction)) {
    return {
      type: 'PROBLEM_LIMIT',
      limitSeconds: finiteInt(source.limitSeconds, 900, 60, 86400),
      action: explicitAction as TrainingProblemTimeAction,
    }
  }

  const legacy = String(source.mode || source.type || 'NONE').toUpperCase()
  if (legacy === 'NONE') return { type: 'NONE' }
  if (legacy === 'SOFT') {
    return { type: 'PROBLEM_LIMIT', limitSeconds: finiteInt(source.limitSeconds, 900, 60, 86400), action: 'REMIND' }
  }
  if (legacy === 'HARD') {
    return { type: 'PROBLEM_LIMIT', limitSeconds: finiteInt(source.limitSeconds, 900, 60, 86400), action: 'LOCK_SUBMISSION' }
  }
  if (legacy === 'SWITCH_REQUIRED') {
    return { type: 'PROBLEM_LIMIT', limitSeconds: finiteInt(source.limitSeconds, 900, 60, 86400), action: 'FORCE_SWITCH' }
  }
  if (legacy === 'RECOMMEND_SWITCH') {
    return { type: 'PROBLEM_LIMIT', limitSeconds: finiteInt(source.limitSeconds, 900, 60, 86400), action: 'RECOMMEND_SWITCH' }
  }
  if (legacy === 'REMIND' || legacy === 'LOCK_SUBMISSION' || legacy === 'FORCE_SWITCH') {
    return { type: 'PROBLEM_LIMIT', limitSeconds: finiteInt(source.limitSeconds, 900, 60, 86400), action: legacy as TrainingProblemTimeAction }
  }
  return { type: 'NONE' }
}

export function serializeTrainingProblemTimePolicy(policy: TrainingProblemTimePolicy) {
  if (policy.type === 'NONE') return { mode: 'NONE' }
  return { mode: policy.action, limitSeconds: policy.limitSeconds, action: policy.action }
}

export function resolveTrainingScorePolicy(input: {
  scoreGoals?: unknown
  targetScore?: unknown
  defaultTargetScore?: unknown
}): TrainingScorePolicy {
  const targets = normalizeTargets(input.scoreGoals)
  if (targets.length > 1) {
    return { type: 'PROGRESSIVE', targets, completionScore: targets[targets.length - 1] }
  }
  const target = finiteInt(input.targetScore ?? input.defaultTargetScore, 100, 0, 100)
  if (target < 100) return { type: 'TARGET_SCORE', targets: [target], completionScore: target }
  return { type: 'AC', targets: targets.length ? targets : [100], completionScore: 100 }
}

export function resolveNextScoreTarget(policy: TrainingScorePolicy, bestScore: number | null | undefined) {
  const score = Number(bestScore || 0)
  return policy.targets.find(target => target > score) ?? null
}

export function resolveTrainingStuckPolicy(...sources: RuleSource[]): TrainingStuckPolicy {
  const merged = Object.assign({}, ...sources.map(source => record(record(source).stuckPolicy || source)))
  return {
    minActiveSeconds: finiteInt(merged.minActiveSeconds, 1800, 60, 86400),
    minAttempts: finiteInt(merged.minAttempts, 3, 1, 1000),
    noImprovementSeconds: finiteInt(merged.noImprovementSeconds, 900, 60, 86400),
  }
}

export function resolveEffectiveTrainingRule(input: {
  stage: {
    kind?: unknown
    accessPolicy?: unknown
    submissionMode?: unknown
    endPolicy?: unknown
    defaultTargetScore?: unknown
    rules?: unknown
  }
  group?: {
    accessPolicy?: unknown
    submissionMode?: unknown
    rules?: unknown
  } | null
  plan?: {
    targetScore?: unknown
    scoreGoals?: unknown
    timePolicy?: unknown
    stuckPolicy?: unknown
    hintPolicy?: unknown
    rules?: unknown
  } | null
  runtimeOverride?: RuleSource
}): EffectiveTrainingRule {
  const stageRules = record(input.stage.rules)
  const groupRules = record(input.group?.rules)
  const planRules = record(input.plan?.rules)
  const runtimeRules = record(input.runtimeOverride)

  const merged = { ...stageRules, ...groupRules, ...planRules, ...runtimeRules }
  const rawTimePolicy = runtimeRules.timePolicy
    ?? input.plan?.timePolicy
    ?? planRules.timePolicy
    ?? groupRules.timePolicy
    ?? stageRules.timePolicy
  const rawStuckPolicy = runtimeRules.stuckPolicy
    ?? input.plan?.stuckPolicy
    ?? planRules.stuckPolicy
    ?? groupRules.stuckPolicy
    ?? stageRules.stuckPolicy
  const rawHintPolicy = record(runtimeRules.hintPolicy
    ?? input.plan?.hintPolicy
    ?? planRules.hintPolicy
    ?? groupRules.hintPolicy
    ?? stageRules.hintPolicy)

  const purpose = String(runtimeRules.purpose ?? merged.purpose ?? input.stage.kind ?? 'TRAINING').toUpperCase()
  const access = String(runtimeRules.problemAccessPolicy ?? merged.problemAccessPolicy ?? input.group?.accessPolicy ?? input.stage.accessPolicy ?? 'ALL_AT_ONCE').toUpperCase()
  const submission = String(runtimeRules.submissionPolicy ?? merged.submissionPolicy ?? input.group?.submissionMode ?? input.stage.submissionMode ?? 'ENABLED').toUpperCase()
  const end = String(runtimeRules.endPolicy ?? merged.endPolicy ?? input.stage.endPolicy ?? 'MANUAL').toUpperCase()

  return {
    purpose: (['TRAINING', 'TEACHING', 'REVIEW'].includes(purpose) ? purpose : 'TRAINING') as TrainingStagePurpose,
    problemAccessPolicy: (['ALL_AT_ONCE', 'SEQUENTIAL', 'TEACHER_CONTROLLED'].includes(access) ? access : 'ALL_AT_ONCE') as TrainingProblemAccessPolicy,
    accessScope: normalizeTrainingAccessScope(runtimeRules.accessScope ?? merged.accessScope),
    timePolicy: normalizeTrainingProblemTimePolicy(rawTimePolicy),
    scorePolicy: resolveTrainingScorePolicy({
      scoreGoals: runtimeRules.scoreGoals ?? input.plan?.scoreGoals ?? planRules.scoreGoals ?? groupRules.scoreGoals ?? stageRules.defaultScoreGoals,
      targetScore: runtimeRules.targetScore ?? input.plan?.targetScore ?? planRules.targetScore ?? groupRules.targetScore,
      defaultTargetScore: input.stage.defaultTargetScore,
    }),
    submissionPolicy: (submission === 'DISABLED' ? 'DISABLED' : 'ENABLED') as TrainingSubmissionPolicy,
    hintPolicy: {
      enabled: rawHintPolicy.enabled !== false,
      ...(rawHintPolicy.mode ? { mode: String(rawHintPolicy.mode).toUpperCase() as TrainingHintPolicy['mode'] } : {}),
      ...(rawHintPolicy.triggerSeconds != null ? { triggerSeconds: finiteInt(rawHintPolicy.triggerSeconds, 60, 60, 86400) } : {}),
      ...(rawHintPolicy.triggerAttempts != null ? { triggerAttempts: finiteInt(rawHintPolicy.triggerAttempts, 1, 1, 1000) } : {}),
      ...(rawHintPolicy.triggerScore != null ? { triggerScore: finiteInt(rawHintPolicy.triggerScore, 0, 0, 100) } : {}),
    },
    endPolicy: (['MANUAL', 'TIME', 'COMPLETION', 'HYBRID'].includes(end) ? end : 'MANUAL') as EffectiveTrainingRule['endPolicy'],
    stuckPolicy: resolveTrainingStuckPolicy(rawStuckPolicy),
  }
}

export function evaluateProblemTimePolicy(policy: TrainingProblemTimePolicy, continuousActiveSeconds: number, completed: boolean) {
  if (policy.type === 'NONE' || completed || continuousActiveSeconds < policy.limitSeconds) {
    return { reached: false, action: null as TrainingProblemTimeAction | null, canSubmit: true, switchRequired: false, switchRecommended: false, remind: false }
  }
  return {
    reached: true,
    action: policy.action,
    canSubmit: !['LOCK_SUBMISSION', 'FORCE_SWITCH'].includes(policy.action),
    switchRequired: policy.action === 'FORCE_SWITCH',
    switchRecommended: policy.action === 'RECOMMEND_SWITCH',
    remind: policy.action === 'REMIND',
  }
}
