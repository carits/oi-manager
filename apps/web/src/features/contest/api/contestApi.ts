import { ContestContracts, type ContestMakeupHomeworkInput } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export function listContestSubmissionUsers(contestId: string) {
  return apiClient.queryContract(ContestContracts.submissionUsers, `/api/contests/${encodeURIComponent(contestId)}/submission-users`)
}

export function createContestMakeupHomework(contestId: string, body: ContestMakeupHomeworkInput) {
  return apiClient.mutateContract(ContestContracts.createMakeupHomework, `/api/contests/${encodeURIComponent(contestId)}/create-makeup-homework`, body)
}
