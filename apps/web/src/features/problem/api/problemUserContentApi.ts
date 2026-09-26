import {
  ProblemContracts,
  type ProblemPersonalContentInput,
  type ProblemPersonalContentKind,
} from '@oi-manager/contracts'
import { apiClient } from '@/lib/apiClient'

const contentPath = (problemId: string) =>
  `/api/problems/${encodeURIComponent(problemId)}/my-content`

const kindPath = (problemId: string, kind: ProblemPersonalContentKind) =>
  `${contentPath(problemId)}/${kind}`

export const getProblemPersonalContent = (problemId: string) =>
  apiClient.queryContract(ProblemContracts.getMyContent, contentPath(problemId))

export const saveProblemPersonalContent = (
  problemId: string,
  kind: ProblemPersonalContentKind,
  body: ProblemPersonalContentInput,
) => apiClient.mutateContract(ProblemContracts.saveMyContent, kindPath(problemId, kind), body)

export const uploadProblemPersonalContentPdf = (
  problemId: string,
  kind: ProblemPersonalContentKind,
  body: FormData,
) => apiClient.postFile<{ id: string; revision: number; fileUrl: string }>(
  `${kindPath(problemId, kind)}/pdf`,
  body,
  { timeout: 30_000 },
)

export const updateProblemPersonalContentShares = (
  problemId: string,
  kind: ProblemPersonalContentKind,
  shareKeys: string[],
) => apiClient.mutateContract(
  ProblemContracts.updateMyContentShares,
  `${kindPath(problemId, kind)}/shares`,
  { shareKeys },
)

export const deleteProblemPersonalContent = (
  problemId: string,
  kind: ProblemPersonalContentKind,
) => apiClient.mutateContract(
  ProblemContracts.deleteMyContent,
  kindPath(problemId, kind),
  {},
)
