export type Subtask = { id: number; score: number; dependencies?: number[] }
export type Revision = { id: string; revisionNumber: number; mode?: string }
export type ProblemSummary = {
  id: string
  platform: string
  problemId: string
  title: string
  difficulty?: string | null
}
export type UnlockCondition = {
  type: 'AC' | 'SCORE' | 'TIME' | 'ATTEMPTS' | 'TEACHER'
  value?: number
}
export type UnlockPolicy = { mode: 'ANY' | 'ALL'; conditions: UnlockCondition[] }
export type Assignment = {
  id?: string
  assignmentId?: string
  clientKey: string
  problemId: string
  testSetRevisionId: string
  alias?: string | null
  unlockPolicy?: UnlockPolicy | null
  targetScore?: number | null
  timeLimitSeconds?: number | null
  strategyIntervalSeconds?: number | null
  maxContinuousWorkSeconds?: number | null
  forceSwitchOnTimeout?: boolean
  allowedSubtaskIds: number[]
  Problem: ProblemSummary
  TestSetRevision: Revision
  latestRevision?: Revision | null
  subtasks: Subtask[]
}
export type Stage = {
  id?: string
  clientKey: string
  name: string
  description?: string | null
  mode: string
  durationSeconds?: number | null
  advanceMode: string
  problemAccessMode: string
  submissionMode: string
  targetScore?: number | null
  completionThreshold?: number | null
  minDurationSeconds?: number | null
  rules?: Record<string, unknown> | null
  Problems: Assignment[]
}
export type Issue = {
  path: string
  code: string
  message: string
  severity: 'error' | 'warning'
}
export type Design = {
  editable: boolean
  statusRevision: number
  session: {
    id: string
    title: string
    description?: string | null
    status: string
    sessionType: string
    organizationId?: string | null
    teamId?: string | null
  }
  stages: Stage[]
  issues: Issue[]
}
export type DesignProblem = ProblemSummary & {
  revision: Revision
  subtasks: Subtask[]
}
export type ProblemPage = {
  data: ProblemSummary[]
  total?: number
  page?: number
  totalPages?: number
}
export type SourceGroup = 'school' | 'carits' | 'external'

export const stageModes = [
  ['FREE', '自由训练'],
  ['SEQUENTIAL', '顺序训练'],
  ['FOCUS', '聚焦阶段'],
  ['SCORE_PROGRESSIVE', '分数递进'],
  ['TEACHING', '统一讲解'],
  ['REVIEW', '复盘补题'],
] as const

export const conditionLabels: Record<UnlockCondition['type'], string> = {
  AC: 'AC 前题',
  SCORE: '分数达标',
  TIME: '用时达标',
  ATTEMPTS: '提交次数',
  TEACHER: '教练放行',
}

export const moveItem = <T,>(items: T[], from: number, to: number) => {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export const normalizeProblemOrder = (items: Assignment[]): Assignment[] =>
  items.map((item, index) => index === 0 || item.unlockPolicy
    ? item
    : { ...item, unlockPolicy: { mode: 'ANY', conditions: [{ type: 'AC' }] } })

export const newTrainingDesignKey = () =>
  globalThis.crypto?.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const normalizeAssignments = (items: Assignment[]) => items.map((item) => ({
  ...item,
  assignmentId: item.assignmentId || item.id,
  clientKey: item.clientKey || item.id || newTrainingDesignKey(),
  allowedSubtaskIds: Array.isArray(item.allowedSubtaskIds) ? item.allowedSubtaskIds.map(Number) : [],
  subtasks: item.subtasks || [],
}))

/** Convert the immutable wire contract into the editable designer draft model. */
export const createTrainingDesignDraft = (data: TrainingDesignContract): Design => ({
  editable: data.editable,
  statusRevision: data.statusRevision,
  session: data.session,
  issues: data.issues,
  stages: data.stages.map(stage => ({
    ...stage,
    clientKey: stage.clientKey || stage.id || newTrainingDesignKey(),
    Problems: normalizeAssignments(stage.Problems.map(problem => ({
      ...problem,
      clientKey: problem.clientKey || problem.assignmentId || problem.id || newTrainingDesignKey(),
      allowedSubtaskIds: problem.allowedSubtaskIds || [],
      subtasks: problem.subtasks || [],
    }))),
  })),
})

export const unlockLabel = (policy?: UnlockPolicy | null) =>
  !policy?.conditions?.length
    ? '未配置'
    : `${policy.mode} · ${policy.conditions.map((item) => `${conditionLabels[item.type]}${item.value == null ? '' : ` ${item.value}`}`).join(' / ')}`
import type { TrainingDesign as TrainingDesignContract } from '@oi-manager/contracts'
