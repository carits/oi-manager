import { SubmissionContracts, type SubmissionCreateInput } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export function getSubmissionDetail(submissionId: number, trainingId?: number, signal?: AbortSignal) {
  const endpoint = trainingId
    ? `/api/contests/${trainingId}/submissions/${submissionId}`
    : `/api/submissions/${submissionId}`
  return apiClient.queryContract(SubmissionContracts.detail, endpoint, { signal })
}

export const submitProblem = (body: SubmissionCreateInput, idempotencyKey: string) =>
  apiClient.mutateContract(
    SubmissionContracts.create,
    '/api/submit',
    body,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  )
