import {
  ProblemContracts,
  type ProblemCreateInput,
  type ProblemEditorMutation,
} from '@oi-manager/contracts'
import { apiClient } from '@/lib/apiClient'

const problemPath = (problemId: string) =>
  `/api/problems/${encodeURIComponent(problemId)}`

export const createProblem = (body: ProblemCreateInput) =>
  apiClient.mutateContract(ProblemContracts.create, '/api/problems', body)

export const copyProblemToSchool = (problemId: string) =>
  apiClient.mutateContract(ProblemContracts.copyToSchool, `${problemPath(problemId)}/copy-to-school`, undefined)

export const getProblemEditorDetail = (problemId: string) =>
  apiClient.queryContract(ProblemContracts.getEditorDetail, problemPath(problemId))

export const updateProblem = (problemId: string, body: ProblemEditorMutation) =>
  apiClient.mutateContract(ProblemContracts.update, problemPath(problemId), body)
