import { ProblemContracts } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

const path = (problemId: string) => `/api/problems/${encodeURIComponent(problemId)}/note`

export const getProblemNote = (problemId: string) =>
  apiClient.queryContract(ProblemContracts.getNote, path(problemId))

export const saveProblemNote = (problemId: string, content: string) =>
  apiClient.mutateContract(ProblemContracts.saveNote, path(problemId), { content })
