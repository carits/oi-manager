import { ProblemContracts, type EndpointBody } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

const collectionPath = (problemId: string) =>
  `/api/problems/${encodeURIComponent(problemId)}/data-generation-jobs`
const jobPath = (problemId: string, jobId: string) =>
  `${collectionPath(problemId)}/${encodeURIComponent(jobId)}`

export const listDataGenerationJobs = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.listDataGenerationJobs,
    collectionPath(problemId),
  )

export const createDataGenerationJob = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.createDataGenerationJob>,
) => apiClient.mutateContract(
  ProblemContracts.createDataGenerationJob,
  collectionPath(problemId),
  body,
)

export const getDataGenerationJob = (problemId: string, jobId: string) =>
  apiClient.queryContract(
    ProblemContracts.getDataGenerationJob,
    jobPath(problemId, jobId),
  )

export const cancelDataGenerationJob = (problemId: string, jobId: string) =>
  apiClient.mutateContract(
    ProblemContracts.cancelDataGenerationJob,
    `${jobPath(problemId, jobId)}/cancel`,
    {},
  )

export const promoteDataGenerationJob = (
  problemId: string,
  jobId: string,
  body: EndpointBody<typeof ProblemContracts.promoteDataGenerationJob>,
) => apiClient.mutateContract(
  ProblemContracts.promoteDataGenerationJob,
  `${jobPath(problemId, jobId)}/promote`,
  body,
)
