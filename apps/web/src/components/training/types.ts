export interface PlatformLanguage {
  id: string
  name: string
}

export interface TrainingInfo {
  id: string
  teamId: string
  title: string
  description: string | null
  type: 'training' | 'contest'
  format: 'oi' | 'ioi' | 'icpc'
  startTime: string
  endTime: string
  status: string
  createdBy: string
  problemIdVisible: boolean
  solutionVisible: boolean
  includeAdminInRanking: boolean
  problemCount: number
  isAdmin: boolean
}

export interface TrainingProblem {
  id: string
  alias: string | null
  orderIndex: number
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
  alias: string | null
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
  }>
  problemTitle?: string
  platform?: string
  platformProblemId?: string
}

export interface SubmissionRow {
  id: number
  userId: string
  userName: string
  username: string
  userType: string
  problemAlias: string
  problemOrderIndex: number
  trainingProblemId: string
  oj: string
  language: string
  result: string
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
  orderIndex: number
  points: number | null
  platform: string | null
  platformProblemId: string | null
  problemTableId: string
  platformLabel: string
  problemUrl: string | null
  bestScore: number | null
  bestResult: string | null
}

export type TabType = 'problems' | 'problemList' | 'submissions' | 'solutions' | 'attachments' | 'ranking'

export function typeLabel(type: string) {
  return type === 'contest' ? '比赛' : '训练'
}

export function formatLabel(format: string) {
  const map: Record<string, string> = { oi: 'OI', ioi: 'IOI', icpc: 'ICPC' }
  return map[format] || format.toUpperCase()
}
