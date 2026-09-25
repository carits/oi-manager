import { SubmissionContracts } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export function getSubmissionDetail(submissionId: number, trainingId?: number, signal?: AbortSignal) {
  const endpoint = trainingId
    ? `/api/contests/${trainingId}/submissions/${submissionId}`
    : `/api/submissions/${submissionId}`
  return apiClient.queryContract(SubmissionContracts.detail, endpoint, { signal })
}
