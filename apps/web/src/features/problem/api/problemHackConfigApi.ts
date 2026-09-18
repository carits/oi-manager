import {
  ProblemContracts,
  type ProblemHackConfigInput,
} from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

const path = (problemId: string) => `/api/problems/${encodeURIComponent(problemId)}/hack-config`

export const getProblemHackConfig = (problemId: string) =>
  apiClient.queryContract(ProblemContracts.getHackConfig, path(problemId))

export const saveProblemHackConfig = (problemId: string, body: ProblemHackConfigInput) =>
  apiClient.mutateContract(ProblemContracts.saveHackConfig, path(problemId), body, { timeout: 150_000 })
