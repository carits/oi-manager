export interface PlatformLanguage {
  id: string
  name: string
}

export interface ContestInfo {
  id: string
  teamId: string | null
  organizationId?: string | null
  scope?: string
  title: string
  description: string | null
  type: 'contest' | 'contest' | 'homework'
  format: 'oi' | 'ioi' | 'icpc'
  startTime: string
  endTime: string
  status: string
  runtimeStatus?: 'upcoming' | 'ongoing' | 'finished'  // 运行时状态（动态计算）
  createdBy: string
  problemIdVisible: boolean
  solutionVisible: boolean
  includeAdminInRanking: boolean
  problemCount: number
  isAdmin: boolean
  sourceContestId?: string | null
  finalizationStatus?: 'LIVE' | 'JUDGING' | 'FINALIZING' | 'FINALIZED' | 'HELD' | 'FAILED'
  finalizedStandingId?: string | null
  ratingConfig?: {
    scope: 'NONE' | 'ORGANIZATION' | 'GLOBAL' | 'BOTH'
    track: 'OI' | 'IOI' | 'ACM'
    weight: number
    locked: boolean
  } | null
}

export interface ContestProblem {
  id: string
  problemSourceHidden?: boolean
  /** @deprecated compatibility with older API payloads */
  problemIdentityHidden?: boolean
  alias?: string | null
  orderIndex?: number
  points: number | null
  hasSolution: boolean
  solutionVisible: boolean
  attachmentCount: number
  problemId?: string
  problemTitle?: string
  platform?: string
  platformProblemId?: string
  difficulty?: string
  timeLimit?: number
  memoryLimit?: number
}

export interface ProblemDetail {
  orderIndex?: number
  problemSourceHidden?: boolean
  /** @deprecated compatibility with older API payloads */
  problemIdentityHidden?: boolean
  alias?: string | null
  points: number | null
  timeLimit: number | null
  memoryLimit: number | null
  difficulty: string | null
  description: string | null
  statementType: string
  statements: Array<{
    id: string
    format: string
    language: string | null
    content: string | null
    fileUrl: string | null
    name?: string
    authorUsername?: string
    isDefault?: boolean
  }>
  problemTitle?: string
  platform?: string
  platformProblemId?: string
  noteContent?: string
  legacyIoSuggestion?: { inputFilename: string | null; outputFilename: string | null } | null
}

export interface SubmissionRow {
  id: number
  userId: string
  userName: string
  username: string
  userType?: string
  problemSourceHidden?: boolean
  /** @deprecated compatibility with older API payloads */
  problemIdentityHidden?: boolean
  problemAlias?: string
  problemOrderIndex?: number
  contestProblemId?: string | null
  oj?: string
  language: string
  result: string | null
  displayResult?: 'pending' | 'queuing' | string  // OI 赛中非管理员显示的脱敏结果
  hidden?: boolean  // OI 赛中非管理员标记
  score: number | null
  timeUsed: number | null
  memoryUsed: number | null
  codeLength: number
  ojRemoteId: string | null
  createdAt: string
}

export interface Attachment {
  id: string
  fileName: string
  fileSize: number
  fileUrl: string
  uploadedBy: string
  uploadedAt: string
}

export interface ProblemListEntry {
  id: string
  alias: string | null
  title: string
  problemTitle?: string
  orderIndex: number
  points: number | null
  platform: string | null
  platformProblemId: string | null
  problemTableId: string
  platformLabel: string
  problemUrl: string | null
  hasSubmitted?: boolean  // 是否已提交（OI 赛中用于显示"已提交"标记）
  bestScore: number | null
  bestResult: string | null
  latestResult?: string | null
  hasAccepted?: boolean
  displayStatus?: string | null
  problemSourceHidden?: boolean
  /** @deprecated compatibility with older API payloads */
  problemIdentityHidden?: boolean
}

export type TabType = 'problems' | 'problemList' | 'submissions' | 'solutions' | 'attachments' | 'ranking'

export function typeLabel(type: string) {
  if (type === 'contest') return '比赛'
  if (type === 'homework') return '作业'
  return '训练'
}

export function formatLabel(format: string) {
  const map: Record<string, string> = { oi: 'OI', ioi: 'IOI', icpc: 'ICPC' }
  return map[format] || '比赛'
}
