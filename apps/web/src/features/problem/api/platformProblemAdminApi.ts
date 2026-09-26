import {
  OjFetcherContracts,
  ProblemContracts,
  type EndpointQuery,
} from '@oi-manager/contracts'
import { apiClient } from '@/lib/apiClient'

type OjJobQuery = EndpointQuery<typeof OjFetcherContracts.listJobs>
type ProblemListQuery = EndpointQuery<typeof ProblemContracts.listAdmin>

function withQuery(path: string, query: Record<string, unknown>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `${path}?${encoded}` : path
}

export const listOjFetchJobs = (query: OjJobQuery) =>
  apiClient.queryContract(
    OjFetcherContracts.listJobs,
    withQuery('/api/oj-fetcher/jobs', query),
  )

export const getOjPlatformConfig = (platform: string) =>
  apiClient.queryContract(
    OjFetcherContracts.getPlatformConfig,
    `/api/oj-fetcher/platforms/${encodeURIComponent(platform)}/config`,
  )

export const updateOjPlatformConfig = (
  platform: string,
  cookies: Record<string, string>,
) => apiClient.mutateContract(
  OjFetcherContracts.updatePlatformConfig,
  `/api/oj-fetcher/platforms/${encodeURIComponent(platform)}/config`,
  { cookies },
)

export const createOjFetchBatch = (platform: string, problemIds: string[]) =>
  apiClient.mutateContract(
    OjFetcherContracts.createBatch,
    '/api/oj-fetcher/jobs/batch',
    { platform, problemIds },
  )

export const retryOjFetchJob = (jobId: string) =>
  apiClient.mutateContract(
    OjFetcherContracts.retryJob,
    `/api/oj-fetcher/jobs/${encodeURIComponent(jobId)}/retry`,
    {},
  )

export const deleteOjFetchJob = (jobId: string) =>
  apiClient.mutateContract(
    OjFetcherContracts.deleteJob,
    `/api/oj-fetcher/jobs/${encodeURIComponent(jobId)}`,
    {},
  )

export const listProblems = (query: ProblemListQuery) =>
  apiClient.queryContract(
    ProblemContracts.listAdmin,
    withQuery('/api/problems', ProblemContracts.listAdmin.query.parse(query)),
  )

export const listPlatformManagedProblems = listProblems

export const archivePlatformManagedProblem = (problemId: string) =>
  apiClient.mutateContract(
    ProblemContracts.archive,
    `/api/problems/${encodeURIComponent(problemId)}`,
    {},
  )
