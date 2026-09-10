import { AssignmentError } from './assignment.error'

export const PROBLEM_CATEGORIES = new Set(['REQUIRED', 'OPTIONAL', 'CHALLENGE'])
export const COMPLETION_POLICIES = new Set(['AC', 'TARGET_SCORE', 'ATTEMPT', 'MANUAL'])
export const ASSIGNMENT_STATUSES = new Set(['DRAFT', 'SCHEDULED', 'OPEN', 'OVERDUE', 'CLOSED', 'REVIEWING', 'RELEASED', 'ARCHIVED', 'CANCELLED'])

const ROSTER_MODES = new Set(['SNAPSHOT', 'DYNAMIC'])
const GRADING_POLICIES = new Set(['BEST_BEFORE_DUE', 'BEST', 'LATEST', 'FIRST_TARGET_MET', 'MANUAL'])
const LATE_POLICIES = new Set(['DISALLOW', 'ALLOW_MARK_LATE', 'ALLOW_NO_PENALTY', 'ALLOW_WITH_PENALTY'])
const CORRECTION_POLICIES = new Set(['NONE', 'BELOW_TARGET', 'NON_AC', 'TEACHER_ASSIGNED', 'ALL_INCOMPLETE'])
const SOLUTION_POLICIES = new Set(['NEVER', 'AFTER_DUE', 'AFTER_CLOSE', 'AFTER_RELEASE'])
const OPTIONAL_SCORING_POLICIES = new Set(['NONE', 'BONUS', 'BEST_N'])
const CHALLENGE_SCORING_POLICIES = new Set(['NONE', 'EXTRA_CREDIT'])

export function enumValue(value: unknown, values: Set<string>, fallback: string, field: string) {
  const normalized = String(value ?? fallback).toUpperCase()
  if (!values.has(normalized)) throw new AssignmentError(422, 'INVALID_ASSIGNMENT', `${field}不受支持`)
  return normalized
}

export function boundedText(value: unknown, max: number, field: string, min = 0) {
  const text = String(value ?? '').trim()
  if (text.length < min || text.length > max) throw new AssignmentError(422, 'INVALID_ASSIGNMENT', `${field}长度必须为 ${min}～${max} 个字符`)
  return text
}

export function boundedInteger(value: unknown, min: number, max: number, field: string, fallback?: number) {
  const parsed = value === undefined && fallback !== undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new AssignmentError(422, 'INVALID_ASSIGNMENT', `${field}必须为 ${min}～${max} 的整数`)
  return parsed
}

function requiredDate(value: unknown, field: string) {
  const date = new Date(String(value ?? ''))
  if (!Number.isFinite(date.getTime())) throw new AssignmentError(422, 'INVALID_ASSIGNMENT', `${field}不是合法时间`)
  return date
}

export function optionalDate(value: unknown, field: string) {
  if (value === undefined || value === null || value === '') return null
  return requiredDate(value, field)
}

function validateTimes(input: { publishAt: Date | null; openAt: Date; dueAt: Date; closeAt: Date; correctionDueAt: Date | null }) {
  if (input.publishAt && input.publishAt > input.openAt) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_TIMELINE', '发布时间不能晚于开放时间')
  if (input.openAt >= input.dueAt) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_TIMELINE', '截止时间必须晚于开放时间')
  if (input.dueAt > input.closeAt) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_TIMELINE', '关闭时间不能早于截止时间')
  if (input.correctionDueAt && input.correctionDueAt < input.closeAt) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_TIMELINE', '订正截止时间不能早于关闭时间')
}

export function clientRevision(body: any) {
  const revision = Number(body?.expectedRevision)
  if (!Number.isInteger(revision) || revision < 0) throw new AssignmentError(422, 'ASSIGNMENT_REVISION_REQUIRED', '必须提供有效的 expectedRevision')
  return revision
}

export function assignmentCreateInput(body: any) {
  const publishAt = optionalDate(body?.publishAt, '发布时间')
  const openAt = requiredDate(body?.openAt, '开放时间')
  const dueAt = requiredDate(body?.dueAt, '截止时间')
  const closeAt = requiredDate(body?.closeAt, '关闭时间')
  const correctionDueAt = optionalDate(body?.correctionDueAt, '订正截止时间')
  validateTimes({ publishAt, openAt, dueAt, closeAt, correctionDueAt })
  const latePolicy = enumValue(body?.latePolicy, LATE_POLICIES, 'DISALLOW', '迟交策略')
  const latePenaltyPercent = latePolicy === 'ALLOW_WITH_PENALTY' ? boundedInteger(body?.latePenaltyPercent, 0, 100, '迟交扣分比例') : null
  const optionalScoringPolicy = enumValue(body?.optionalScoringPolicy, OPTIONAL_SCORING_POLICIES, 'NONE', '选做题计分策略')
  const challengeScoringPolicy = enumValue(body?.challengeScoringPolicy, CHALLENGE_SCORING_POLICIES, 'NONE', '挑战题计分策略')
  return {
    title: boundedText(body?.title, 200, '作业名称', 1),
    description: body?.description ? boundedText(body.description, 10_000, '作业说明') : null,
    learningObjectives: body?.learningObjectives ? boundedText(body.learningObjectives, 10_000, '学习目标') : null,
    rosterMode: enumValue(body?.rosterMode, ROSTER_MODES, 'SNAPSHOT', '名单模式'),
    gradingPolicy: enumValue(body?.gradingPolicy, GRADING_POLICIES, 'BEST_BEFORE_DUE', '评分策略'),
    latePolicy,
    correctionPolicy: enumValue(body?.correctionPolicy, CORRECTION_POLICIES, 'NONE', '订正策略'),
    solutionReleasePolicy: enumValue(body?.solutionReleasePolicy, SOLUTION_POLICIES, 'AFTER_RELEASE', '题解开放策略'),
    latePenaltyPercent,
    gradingVersion: 2,
    baseScoreMax: boundedInteger(body?.baseScoreMax, 1, 1000, '基础成绩满分', 100),
    optionalScoringPolicy,
    optionalBestCount: optionalScoringPolicy === 'BEST_N' ? boundedInteger(body?.optionalBestCount, 1, 1000, '选做题计分数量', 1) : null,
    optionalBonusMax: optionalScoringPolicy === 'NONE' ? 0 : boundedInteger(body?.optionalBonusMax, 1, 1000, '选做题加分上限', 10),
    challengeScoringPolicy,
    challengeBonusMax: challengeScoringPolicy === 'NONE' ? 0 : boundedInteger(body?.challengeBonusMax, 1, 1000, '挑战题加分上限', 10),
    publishAt, openAt, dueAt, closeAt, correctionDueAt,
  }
}

export function validateProblemRows(rows: any[]) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_PROBLEMS', '作业必须包含 1～100 道题')
  const ids = rows.map(row => String(row?.problemId || ''))
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new AssignmentError(422, 'INVALID_ASSIGNMENT_PROBLEMS', '题目不能为空或重复')
  return ids
}
