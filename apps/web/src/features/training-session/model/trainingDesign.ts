import type { TrainingDesign as TrainingDesignContract } from '@oi-manager/contracts'

export type Subtask = { id: number; score: number; dependencies?: number[] }
export type Revision = { id: string; revisionNumber: number; mode?: string }
export type ProblemSummary = { id: string; platform: string; problemId: string; title: string; difficulty?: string | null }
export type UnlockCondition = { type: 'AC' | 'SCORE' | 'TIME' | 'ATTEMPTS' | 'TEACHER'; value?: number }
export type UnlockPolicy = { mode: 'ANY' | 'ALL'; conditions: UnlockCondition[] }
export type ProblemTimeAction = 'REMIND' | 'RECOMMEND_SWITCH' | 'LOCK_SUBMISSION' | 'FORCE_SWITCH'
export type ProblemTimePolicy = { mode: 'NONE' } | { mode: ProblemTimeAction; action?: ProblemTimeAction; limitSeconds: number }
export type StuckPolicy = { minActiveSeconds: number; minAttempts: number; noImprovementSeconds: number }
export type Assignment = {
  id?: string; assignmentId?: string; clientKey: string; problemId: string; testSetRevisionId: string; alias?: string | null
  unlockPolicy?: UnlockPolicy | null; targetScore?: number | null; scoreGoals?: Array<{ score: number; allowedSubtaskIds?: number[] }> | null
  timePolicy?: ProblemTimePolicy | null; stuckPolicy?: StuckPolicy | null; strategyIntervalSeconds?: number | null; allowedSubtaskIds: number[]
  Problem: ProblemSummary; TestSetRevision: Revision; latestRevision?: Revision | null; subtasks: Subtask[]
}
export type TrainingGroup = { id?: string; clientKey: string; name: string; orderIndex?: number; status?: string; participantIds: string[] }
export type Stage = { id?: string; clientKey: string; name: string; description?: string | null; orderIndex?: number; kind: 'TRAINING' | 'TEACHING' | 'REVIEW'; Problems: Assignment[] }
export type StageGroup = {
  id: string; clientKey: string; stageId: string; stageName: string; groupId: string; groupName: string
  mode: 'PRACTICE' | 'EXAM' | 'GUIDED' | 'REVIEW'; accessPolicy: 'ALL_AT_ONCE' | 'SEQUENTIAL' | 'TEACHER_CONTROLLED'; submissionMode: 'ENABLED' | 'DISABLED'
  plannedDurationSeconds?: number | null; completionThreshold?: number | null; minDurationSeconds?: number | null
  completionPolicy?: Record<string, unknown> | null; transitionPolicy: 'WAIT_FOR_TEACHER' | 'AUTO_ADVANCE'; problemIds: string[]; rules?: Record<string, unknown> | null
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'ENDED' | 'SKIPPED'; startedAt?: string | null; runningSince?: string | null; activeElapsedSeconds: number; endedAt?: string | null; endReason?: string | null
}
export type TrainingGrouping = { groups: TrainingGroup[]; memberships: Array<{ participantId: string; userId: string; groupId: string; groupName: string }> }
export type Issue = { path: string; code: string; message: string; severity: 'error' | 'warning' }
export type Design = {
  editable: boolean; statusRevision: number
  session: { id: string; title: string; description?: string | null; status: string; sessionType: string; organizationId?: string | null; teamId?: string | null }
  participants: Array<{ id: string; userId: string; groupId: string }>
  groups: TrainingGroup[]; stages: Stage[]; stageGroups: StageGroup[]; issues: Issue[]
}
export type DesignProblem = ProblemSummary & { revision: Revision; subtasks: Subtask[] }
export type ProblemPage = { data: ProblemSummary[]; total?: number; page?: number; totalPages?: number }
export type SourceGroup = 'school' | 'carits' | 'external'

export const stageKinds = [['TRAINING', '练习'], ['TEACHING', '统一讲解'], ['REVIEW', '复盘']] as const
export const conditionLabels: Record<UnlockCondition['type'], string> = { AC: 'AC 前题', SCORE: '分数达标', TIME: '用时达标', ATTEMPTS: '提交次数', TEACHER: '教练放行' }
export const moveItem = <T,>(items: T[], from: number, to: number) => { const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next }
export const normalizeProblemOrder = (items: Assignment[]): Assignment[] => items.map((item, index) => index === 0 || item.unlockPolicy ? item : { ...item, unlockPolicy: { mode: 'ANY', conditions: [{ type: 'AC' }] } })
export const closeSubtaskSelection = (subtasks: Subtask[], selectedIds: number[]) => {
  const byId = new Map(subtasks.map(item => [item.id, item])); const selected = new Set(selectedIds)
  const addDependencies = (id: number, visiting = new Set<number>()) => { if (visiting.has(id)) return; const next = new Set(visiting); next.add(id); for (const dependencyId of byId.get(id)?.dependencies || []) { selected.add(dependencyId); addDependencies(dependencyId, next) } }
  for (const id of [...selected]) addDependencies(id); return [...selected].sort((a, b) => a - b)
}
export const removeSubtaskWithDependents = (subtasks: Subtask[], selectedIds: number[], removedId: number) => {
  const selected = new Set(selectedIds); selected.delete(removedId); let changed = true
  while (changed) { changed = false; for (const subtask of subtasks) if (selected.has(subtask.id) && (subtask.dependencies || []).some(id => !selected.has(id))) { selected.delete(subtask.id); changed = true } }
  return [...selected].sort((a, b) => a - b)
}
export const newTrainingDesignKey = () => globalThis.crypto?.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`
export const normalizeAssignments = (items: Assignment[]) => items.map(item => ({ ...item, assignmentId: item.assignmentId || item.id, clientKey: item.clientKey || item.id || newTrainingDesignKey(), allowedSubtaskIds: Array.isArray(item.allowedSubtaskIds) ? item.allowedSubtaskIds.map(Number) : [], subtasks: item.subtasks || [] }))
export const isTrainingStageDefinitionLocked = (stageId: string | undefined, stageGroups: StageGroup[]) => Boolean(stageId && stageGroups.some(unit => unit.stageId === stageId && unit.status !== 'PENDING'))
export const isTrainingGroupingDefinitionLocked = (sessionStatus: string, stageGroups: StageGroup[]) => !['DRAFT', 'SCHEDULED'].includes(sessionStatus) || stageGroups.some(unit => unit.status !== 'PENDING')
export const createTrainingDesignDraft = (data: TrainingDesignContract): Design => ({
  editable: data.editable, statusRevision: data.statusRevision, session: data.session, issues: data.issues,
  participants: data.participants, groups: data.groups.map(group => ({ ...group, clientKey: group.clientKey || group.id || newTrainingDesignKey(), participantIds: group.participantIds || [] })),
  stages: data.stages.map(stage => ({ ...stage, clientKey: stage.clientKey || stage.id || newTrainingDesignKey(), Problems: normalizeAssignments(stage.Problems.map(problem => ({ ...problem, clientKey: problem.clientKey || problem.assignmentId || problem.id || newTrainingDesignKey(), allowedSubtaskIds: problem.allowedSubtaskIds || [], subtasks: problem.subtasks || [] }))) })),
  stageGroups: data.stageGroups.map(unit => ({ ...unit, clientKey: unit.clientKey || unit.id || newTrainingDesignKey() })),
})
export const unlockLabel = (policy?: UnlockPolicy | null) => !policy?.conditions?.length ? '未配置' : `${policy.mode} · ${policy.conditions.map(item => `${conditionLabels[item.type]}${item.value == null ? '' : ` ${item.value}`}`).join(' / ')}`