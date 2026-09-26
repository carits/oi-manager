import { ProblemContracts, type EndpointBody } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

const problemPath = (problemId: string) => `/api/problems/${encodeURIComponent(problemId)}`
const validatorPath = (problemId: string, requestId?: string) =>
  `${problemPath(problemId)}/ai/validator${requestId ? `/${encodeURIComponent(requestId)}` : ''}`

export const generateAiValidator = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.generateAiValidator>,
) => apiClient.mutateContract(
  ProblemContracts.generateAiValidator,
  validatorPath(problemId),
  body,
)

export const repairAiValidator = (problemId: string, requestId: string) =>
  apiClient.mutateContract(
    ProblemContracts.repairAiValidator,
    `${validatorPath(problemId, requestId)}/repair`,
    {},
  )

export const getAiValidatorRequest = (problemId: string, requestId: string) =>
  apiClient.queryContract(
    ProblemContracts.getAiValidatorRequest,
    validatorPath(problemId, requestId),
  )

export const saveAiValidator = (
  problemId: string,
  requestId: string,
  body: EndpointBody<typeof ProblemContracts.saveAiValidator>,
) => apiClient.mutateContract(
  ProblemContracts.saveAiValidator,
  `${validatorPath(problemId, requestId)}/save`,
  body,
)

export const generateAiValidatorSpec = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.generateAiValidatorSpec>,
) => apiClient.mutateContract(
  ProblemContracts.generateAiValidatorSpec,
  `${problemPath(problemId)}/ai/validator-spec`,
  body,
)

export const saveAiValidatorSpec = (problemId: string, requestId: string) =>
  apiClient.mutateContract(
    ProblemContracts.saveAiValidatorSpec,
    `${problemPath(problemId)}/ai/validator-spec/${encodeURIComponent(requestId)}/save`,
    {},
  )
