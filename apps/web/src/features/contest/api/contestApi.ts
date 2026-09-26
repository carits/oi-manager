import {
  ContestContracts,
  type ContestMakeupHomeworkInput,
  type EndpointBody,
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

function contestProblemPath(contestId: string, contestProblemId: string) {
  return `/api/contests/${encodeURIComponent(contestId)}/problems/${encodeURIComponent(contestProblemId)}`
}

export function getContestContentOptions(contestId: string, contestProblemId: string) {
  return apiClient.queryContract(ContestContracts.contentOptions, `${contestProblemPath(contestId, contestProblemId)}/content-options`)
}

export function previewContestContentOption(contestId: string, contestProblemId: string, optionKey: string) {
  return apiClient.queryContract(
    ContestContracts.contentPreview,
    `${contestProblemPath(contestId, contestProblemId)}/content-options/${encodeURIComponent(optionKey)}/preview`,
  )
}

export function updateContestContentSelection(
  contestId: string,
  contestProblemId: string,
  body: EndpointBody<typeof ContestContracts.updateContentSelection>,
) {
  return apiClient.mutateContract(
    ContestContracts.updateContentSelection,
    `${contestProblemPath(contestId, contestProblemId)}/content-selection`,
    body,
  )
}

export function updateContestContentMarkdown(
  contestId: string,
  contestProblemId: string,
  kind: 'statement' | 'solution',
  content: string,
) {
  return apiClient.mutateContract(
    ContestContracts.updateContentMarkdown,
    `${contestProblemPath(contestId, contestProblemId)}/content/${kind}`,
    { content },
  )
}

/** Contest PDF content upload is a registered multipart transport. */
export function uploadContestContentPdf(
  contestId: string,
  contestProblemId: string,
  kind: 'statement' | 'solution',
  file: File,
) {
  const body = new FormData()
  body.append('file', file)
  return apiClient.postFile(`${contestProblemPath(contestId, contestProblemId)}/content/${kind}/pdf`, body, { timeout: 30000 })
}

export function getContestStatementManagement(contestId: string) {
  return apiClient.queryContract(ContestContracts.statementManagement, `/api/contests/${encodeURIComponent(contestId)}/statement-management`)
}

export function saveContestStatementManagement(
  contestId: string,
  body: EndpointBody<typeof ContestContracts.saveStatementManagement>,
) {
  return apiClient.mutateContract(
    ContestContracts.saveStatementManagement,
    `/api/contests/${encodeURIComponent(contestId)}/statement-management`,
    body,
  )
}

export function previewContestTestSetUpdate(contestId: string, contestProblemId: string) {
  return apiClient.queryContract(
    ContestContracts.testSetUpdatePreview,
    `${contestProblemPath(contestId, contestProblemId)}/test-set-update`,
  )
}

export function applyContestTestSetUpdate(contestId: string, contestProblemId: string, revisionId?: string) {
  return apiClient.mutateContract(
    ContestContracts.testSetUpdate,
    `${contestProblemPath(contestId, contestProblemId)}/test-set-update`,
    { revisionId },
  )
}

export function createContestMakeupHomework(contestId: string, body: ContestMakeupHomeworkInput) {
  return apiClient.mutateContract(ContestContracts.createMakeupHomework, `/api/contests/${encodeURIComponent(contestId)}/create-makeup-homework`, body)
}
