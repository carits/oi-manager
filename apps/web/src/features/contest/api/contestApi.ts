import { ContestContracts, type ContestMakeupHomeworkInput } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export function listTeamContests(teamId: string) {
  const query = ContestContracts.listTeam.query.parse({ type: 'contest' })
  return apiClient.queryContract(ContestContracts.listTeam, `/api/teams/${encodeURIComponent(teamId)}/contests?type=${query.type}`)
}

export function listContestSubmissionUsers(contestId: string) {
  return apiClient.queryContract(ContestContracts.submissionUsers, `/api/contests/${encodeURIComponent(contestId)}/submission-users`)
}

export function createContestMakeupHomework(contestId: string, body: ContestMakeupHomeworkInput) {
  return apiClient.mutateContract(ContestContracts.createMakeupHomework, `/api/contests/${encodeURIComponent(contestId)}/create-makeup-homework`, body)
}
