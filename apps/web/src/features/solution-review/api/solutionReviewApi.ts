import {
  SolutionReviewContracts,
  type EndpointBody,
  type EndpointQuery,
} from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

const encode = (value: string) => encodeURIComponent(value)

export function listProblemSolutions(problemId: string) {
  return apiClient.queryContract(
    SolutionReviewContracts.listProblemSolutions,
    `/api/problems/${encode(problemId)}/solutions`,
  )
}

export function createSolutionContribution(
  problemId: string,
  body: EndpointBody<typeof SolutionReviewContracts.createContribution>,
) {
  return apiClient.mutateContract(
    SolutionReviewContracts.createContribution,
    `/api/problems/${encode(problemId)}/solution-contributions`,
    body,
  )
}

export function listMySolutionContributions(problemId: string) {
  return apiClient.queryContract(
    SolutionReviewContracts.listMyContributions,
    `/api/problems/${encode(problemId)}/solution-contributions/me`,
  )
}

export function getSolutionContribution(contributionId: string) {
  return apiClient.queryContract(
    SolutionReviewContracts.getContribution,
    `/api/solution-contributions/${encode(contributionId)}`,
  )
}

export function updateSolutionContribution(
  contributionId: string,
  body: EndpointBody<typeof SolutionReviewContracts.updateContribution>,
) {
  return apiClient.mutateContract(
    SolutionReviewContracts.updateContribution,
    `/api/solution-contributions/${encode(contributionId)}`,
    body,
  )
}

export function submitSolutionContribution(contributionId: string) {
  return apiClient.mutateContract(
    SolutionReviewContracts.submitContribution,
    `/api/solution-contributions/${encode(contributionId)}/submit`,
    {},
  )
}

export function resubmitSolutionContribution(contributionId: string) {
  return apiClient.mutateContract(
    SolutionReviewContracts.resubmitContribution,
    `/api/solution-contributions/${encode(contributionId)}/resubmit`,
    {},
  )
}

export function refreshSolutionContributionVerification(contributionId: string) {
  return apiClient.mutateContract(
    SolutionReviewContracts.refreshVerification,
    `/api/solution-contributions/${encode(contributionId)}/verification/refresh`,
    {},
  )
}

export function getProblemSolution(solutionId: string, versionId?: string) {
  const suffix = versionId ? `/versions/${encode(versionId)}` : ''
  const contract = versionId
    ? SolutionReviewContracts.getSolutionVersion
    : SolutionReviewContracts.getSolution
  return apiClient.queryContract(
    contract,
    `/api/solutions/${encode(solutionId)}${suffix}`,
  )
}

export function createSolutionCorrection(
  solutionId: string,
  body: EndpointBody<typeof SolutionReviewContracts.createCorrection>,
) {
  return apiClient.mutateContract(
    SolutionReviewContracts.createCorrection,
    `/api/solutions/${encode(solutionId)}/corrections`,
    body,
  )
}

export function listSolutionReviewQueue(
  query: EndpointQuery<typeof SolutionReviewContracts.reviewQueue> = {},
) {
  const parsed = SolutionReviewContracts.reviewQueue.query.parse(query)
  const params = new URLSearchParams()
  if (parsed.status) params.set('status', parsed.status)
  const suffix = params.size ? `?${params.toString()}` : ''
  return apiClient.queryContract(
    SolutionReviewContracts.reviewQueue,
    `/api/review/solution-contributions${suffix}`,
  )
}

export function getSimilarityComparison(contributionId: string) {
  return apiClient.queryContract(
    SolutionReviewContracts.similarityComparison,
    `/api/review/solution-contributions/${encode(contributionId)}/similarity-comparison`,
  )
}

export function recordSolutionReview(
  contributionId: string,
  body: EndpointBody<typeof SolutionReviewContracts.recordReview>,
) {
  return apiClient.mutateContract(
    SolutionReviewContracts.recordReview,
    `/api/review/solution-contributions/${encode(contributionId)}/reviews`,
    body,
  )
}

export function requestSolutionRevision(
  contributionId: string,
  body: EndpointBody<typeof SolutionReviewContracts.requestRevision>,
) {
  return apiClient.mutateContract(
    SolutionReviewContracts.requestRevision,
    `/api/review/solution-contributions/${encode(contributionId)}/request-revision`,
    body,
  )
}

export function rejectSolutionContribution(
  contributionId: string,
  body: EndpointBody<typeof SolutionReviewContracts.rejectContribution>,
) {
  return apiClient.mutateContract(
    SolutionReviewContracts.rejectContribution,
    `/api/review/solution-contributions/${encode(contributionId)}/reject`,
    body,
  )
}

export function acceptSolutionContribution(contributionId: string) {
  return apiClient.mutateContract(
    SolutionReviewContracts.acceptContribution,
    `/api/review/solution-contributions/${encode(contributionId)}/accept`,
    {},
  )
}

export function publishSolutionContribution(
  contributionId: string,
  body: EndpointBody<typeof SolutionReviewContracts.publishContribution>,
) {
  return apiClient.mutateContract(
    SolutionReviewContracts.publishContribution,
    `/api/review/solution-contributions/${encode(contributionId)}/publish`,
    body,
  )
}

export function retrySolutionSimilarity(contributionId: string) {
  return apiClient.mutateContract(
    SolutionReviewContracts.retrySimilarity,
    `/api/review/solution-contributions/${encode(contributionId)}/similarity/retry`,
    {},
  )
}
