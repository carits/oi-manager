import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/apiClient'
import { shouldPollSubmissionDetail, shouldRetrySubmissionPoll } from './submission-polling'

describe('submission detail polling policy', () => {
  it('polls only visible queuing or judging submissions', () => {
    expect(shouldPollSubmissionDetail({ result: 'queuing' })).toBe(true)
    expect(shouldPollSubmissionDetail({ result: 'judging' })).toBe(true)
    expect(shouldPollSubmissionDetail({ result: 'accepted' })).toBe(false)
    expect(shouldPollSubmissionDetail({ result: 'queuing', hidden: true })).toBe(false)
  })

  it.each([
    new ApiError({ kind: 'network', status: 0, message: 'offline' }),
    new ApiError({ kind: 'timeout', status: 0, message: 'timeout' }),
    new ApiError({ kind: 'http', status: 429, message: 'rate limited' }),
    new ApiError({ kind: 'http', status: 503, message: 'unavailable' }),
  ])('retries transient detail failures', error => {
    expect(shouldRetrySubmissionPoll(error)).toBe(true)
  })

  it.each([401, 403, 404, 422])('stops polling for permanent HTTP %s failures', status => {
    const error = new ApiError({ kind: 'http', status, message: 'permanent' })
    expect(shouldRetrySubmissionPoll(error)).toBe(false)
  })

  it('does not loop on unexpected programming errors', () => {
    expect(shouldRetrySubmissionPoll(new Error('unexpected'))).toBe(false)
  })
})
