import { ApiError } from '@/lib/apiClient'

interface PollableSubmissionDetail {
  result: string | null
  hidden?: boolean
}

export function shouldPollSubmissionDetail(detail: PollableSubmissionDetail): boolean {
  return !detail.hidden && (detail.result === 'queuing' || detail.result === 'judging')
}

export function shouldRetrySubmissionPoll(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.kind === 'network' || error.kind === 'timeout') return true
  if (error.kind !== 'http') return false
  return error.status === 429 || error.status >= 500
}
