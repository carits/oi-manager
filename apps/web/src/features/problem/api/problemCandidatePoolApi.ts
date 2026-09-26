import { ProblemContracts, type EndpointBody } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

const problemPath = (problemId: string) => `/api/problems/${encodeURIComponent(problemId)}`

export const getCandidatePool = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.getCandidatePool,
    `${problemPath(problemId)}/candidate-pool`,
  )

export const updateCandidatePolicy = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.updateCandidatePolicy>,
) => apiClient.mutateContract(
  ProblemContracts.updateCandidatePolicy,
  `${problemPath(problemId)}/candidate-policy`,
  body,
)

export const previewCandidateSelector = (problemId: string) =>
  apiClient.mutateContract(
    ProblemContracts.previewCandidateSelector,
    `${problemPath(problemId)}/selector-runs/preview`,
    {},
  )

export const emergencyPublishCandidate = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.emergencyPublishCandidate>,
) => apiClient.mutateContract(
  ProblemContracts.emergencyPublishCandidate,
  `${problemPath(problemId)}/canonical-emergency-publish`,
  body,
)

export const getWrongCorpus = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.getWrongCorpus,
    `${problemPath(problemId)}/wrong-corpus`,
  )

export const rebuildWrongCorpus = (problemId: string) =>
  apiClient.mutateContract(
    ProblemContracts.rebuildWrongCorpus,
    `${problemPath(problemId)}/wrong-corpus/rebuild`,
    {},
  )
