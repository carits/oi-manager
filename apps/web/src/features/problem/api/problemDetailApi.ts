import {
  ProblemContracts,
  type EndpointBody,
  type EndpointQuery,
} from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

const path = (problemId: string) => `/api/problems/${encodeURIComponent(problemId)}`

export const getProblemDetail = (problemId: string) =>
  apiClient.queryContract(ProblemContracts.getEditorDetail, path(problemId))

export const listProblemSubmissions = (
  problemId: string,
  query: EndpointQuery<typeof ProblemContracts.listSubmissions>,
) => {
  const parsed = ProblemContracts.listSubmissions.query.parse(query)
  const search = new URLSearchParams({
    page: String(parsed.page),
    pageSize: String(parsed.pageSize),
  })
  return apiClient.queryContract(
    ProblemContracts.listSubmissions,
    `${path(problemId)}/submissions?${search.toString()}`,
  )
}

export const getProblemAiUsage = (problemId: string) =>
  apiClient.queryContract(ProblemContracts.getAiUsage, `${path(problemId)}/ai/usage`)

export const translateProblemStatement = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.translateStatement>,
) => apiClient.mutateContract(
  ProblemContracts.translateStatement,
  `${path(problemId)}/ai/translate`,
  body,
)

export const formatProblemStatement = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.formatStatement>,
) => apiClient.mutateContract(
  ProblemContracts.formatStatement,
  `${path(problemId)}/ai/format`,
  body,
)
