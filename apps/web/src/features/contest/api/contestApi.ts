import {
  ContestContracts,
  type ContestMakeupHomeworkInput,
  type ContestRejudgeScope,
  type ContestSubmissionListQuery,
} from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export function listTeamContests(teamId: string) {
  const query = ContestContracts.listTeam.query.parse({ type: 'contest' })
  return apiClient.queryContract(ContestContracts.listTeam, `/api/teams/${encodeURIComponent(teamId)}/contests?type=${query.type}`)
}

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  return params.toString()
}

export function listContestSubmissionUsers(contestId: string) {
  return apiClient.queryContract(ContestContracts.submissionUsers, `/api/contests/${encodeURIComponent(contestId)}/submission-users`)
}

export function listContestSubmissions(contestId: string, query: ContestSubmissionListQuery, signal?: AbortSignal) {
  const normalized = ContestContracts.submissions.query.parse(query)
  return apiClient.queryContract(
    ContestContracts.submissions,
    `/api/contests/${encodeURIComponent(contestId)}/submissions?${queryString(normalized)}`,
    { signal },
  )
}

export function previewContestRejudge(
  contestId: string,
  query: { scopeType: 'all' | 'problem' | 'user_problem'; contestProblemId?: string; userId?: string },
) {
  const normalized = ContestContracts.rejudgePreview.query.parse(query)
  return apiClient.queryContract(
    ContestContracts.rejudgePreview,
    `/api/contests/${encodeURIComponent(contestId)}/rejudge/preview?${queryString(normalized)}`,
  )
}

export function rejudgeContest(contestId: string, scope: ContestRejudgeScope) {
  return apiClient.mutateContract(
    ContestContracts.rejudge,
    `/api/contests/${encodeURIComponent(contestId)}/rejudge`,
    { scope },
  )
}

export function createContestMakeupHomework(contestId: string, body: ContestMakeupHomeworkInput) {
  return apiClient.mutateContract(ContestContracts.createMakeupHomework, `/api/contests/${encodeURIComponent(contestId)}/create-makeup-homework`, body)
}
