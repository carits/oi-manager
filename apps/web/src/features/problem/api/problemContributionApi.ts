import {
  ProblemContracts,
  type EndpointBody,
  type EndpointQuery,
} from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

const path = (problemId: string) => `/api/problems/${encodeURIComponent(problemId)}`

export const getProblemContributionReadiness = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.getContributionReadiness,
    `${path(problemId)}/contribution-readiness`,
  )

export const listProblemContributions = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.listContributions,
    `${path(problemId)}/contributions/mine`,
  )

export const contributeProblemCandidateData = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.contributeCandidateData>,
) => apiClient.mutateContract(
  ProblemContracts.contributeCandidateData,
  `${path(problemId)}/candidates/data`,
  body,
)

export const contributeProblemCandidateGenerator = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.contributeCandidateGenerator>,
) => apiClient.mutateContract(
  ProblemContracts.contributeCandidateGenerator,
  `${path(problemId)}/candidates/generator`,
  body,
)

export const listProblemHackAttempts = (
  problemId: string,
  query: EndpointQuery<typeof ProblemContracts.listHackAttempts>,
) => {
  const parsed = ProblemContracts.listHackAttempts.query.parse(query)
  const search = new URLSearchParams({
    page: String(parsed.page),
    pageSize: String(parsed.pageSize),
  })
  return apiClient.queryContract(
    ProblemContracts.listHackAttempts,
    `${path(problemId)}/hacks?${search.toString()}`,
  )
}

export const createProblemHackAttempt = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.createHackAttempt>,
) => apiClient.mutateContract(
  ProblemContracts.createHackAttempt,
  `${path(problemId)}/hacks`,
  body,
)

export const getProblemHackAttempt = (problemId: string, hackId: string) =>
  apiClient.queryContract(
    ProblemContracts.getHackAttempt,
    `${path(problemId)}/hacks/${encodeURIComponent(hackId)}`,
  )

export const retryProblemHackAttempt = (problemId: string, hackId: string) =>
  apiClient.mutateContract(
    ProblemContracts.retryHackAttempt,
    `${path(problemId)}/hacks/${encodeURIComponent(hackId)}/retry`,
    {},
  )
