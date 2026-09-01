import type { JudgeCaseResult, JudgeSubtaskResult } from './judge-result'

export interface SubmissionDetailDto {
  id: number
  userId?: string
  username: string
  submitterName?: string
  submitterAvatar?: string | null
  oj?: string
  problemId?: string
  problemTitle?: string | null
  problemSourceHidden?: boolean
  problemIdentityHidden?: boolean
  sourcePlatform?: string | null
  sourceProblemId?: string | null
  result: string | null
  displayResult?: string
  hidden?: boolean
  timeUsed: number | null
  memoryUsed: number | null
  wallTimeUsed?: number | null
  timeoutReason?: string | null
  metricSource?: string | null
  score?: number | null
  cases?: JudgeCaseResult[] | null
  subtasks?: JudgeSubtaskResult[] | null
  codeLength: number
  language: string
  code: string | null
  canViewCode?: boolean
  submitMethod: string
  ojRemoteId: string | null
  hideRemoteId?: boolean
  ojAccountUsername?: string | null
  submittedAt: string
  errorMessage: string | null
  judgeMode?: 'acm' | 'oi'
  trainingId?: number | null
  trainingProblemId?: string | null
  problemAlias?: string | null
  problemOrderIndex?: number | null
  contestFormat?: string | null
  io?: {
    input: { type: 'stdin' } | { type: 'file'; filename: string }
    output: { type: 'stdout' } | { type: 'file'; filename: string }
  }
}
