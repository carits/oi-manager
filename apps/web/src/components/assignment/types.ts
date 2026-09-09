export type AssignmentStatus = 'DRAFT' | 'SCHEDULED' | 'OPEN' | 'OVERDUE' | 'CLOSED' | 'REVIEWING' | 'RELEASED' | 'ARCHIVED' | 'CANCELLED'

export interface AssignmentProblem {
  id: string
  problemId: string
  testSetRevisionId: string
  orderIndex: number
  category: 'REQUIRED' | 'OPTIONAL' | 'CHALLENGE'
  required: boolean
  maxScore: number
  judgeMaxScore: number
  targetScore: number
  weight: number
  completionPolicy: 'AC' | 'TARGET_SCORE' | 'ATTEMPT' | 'MANUAL'
  Problem: { id: string; platform: string; problemId: string; title: string; difficulty?: string | null; allowedLanguages?: string | null }
  TestSetRevision: { id: string; revisionNumber: number; mode: 'acm' | 'oi'; judgeConfigHash: string }
}

export interface AssignmentRecipient {
  id: string
  userId: string
  status: string
  dueAtEffective: string
  closeAtEffective: string
  User: { id: string; username: string; avatar?: string | null }
}

export interface Assignment {
  id: string
  organizationId: string
  teamId?: string | null
  title: string
  description?: string | null
  learningObjectives?: string | null
  status: AssignmentStatus
  statusRevision: number
  rosterMode: 'SNAPSHOT' | 'DYNAMIC'
  gradingPolicy: string
  gradingVersion: number
  baseScoreMax: number
  optionalScoringPolicy: 'NONE' | 'BONUS' | 'BEST_N'
  optionalBestCount?: number | null
  optionalBonusMax: number
  challengeScoringPolicy: 'NONE' | 'EXTRA_CREDIT'
  challengeBonusMax: number
  latePolicy: string
  correctionPolicy: string
  solutionReleasePolicy: string
  latePenaltyPercent?: number | null
  publishAt?: string | null
  openAt: string
  dueAt: string
  closeAt: string
  correctionDueAt?: string | null
  editable: boolean
  problemCount: number
  recipientCount: number
  Problems: AssignmentProblem[]
  Recipients: AssignmentRecipient[]
}

export interface AssignmentListPayload {
  items: Assignment[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

export const assignmentStatusMeta: Record<AssignmentStatus, { label: string; variant: 'neutral' | 'info' | 'success' | 'warning' | 'error' }> = {
  DRAFT: { label: '草稿', variant: 'neutral' },
  SCHEDULED: { label: '待开放', variant: 'info' },
  OPEN: { label: '进行中', variant: 'success' },
  OVERDUE: { label: '迟交期', variant: 'warning' },
  CLOSED: { label: '已关闭', variant: 'neutral' },
  REVIEWING: { label: '批改中', variant: 'warning' },
  RELEASED: { label: '已发布成绩', variant: 'success' },
  ARCHIVED: { label: '已归档', variant: 'neutral' },
  CANCELLED: { label: '已取消', variant: 'error' },
}

export function formatAssignmentTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
