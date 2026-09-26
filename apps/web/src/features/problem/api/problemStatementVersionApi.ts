import {
  ProblemContracts,
  type ProblemStatementVersion,
  type ProblemStatementVersionContentInput,
  type ProblemStatementVersionCreateInput,
  type ProblemStatementVersionMetadataInput,
} from '@oi-manager/contracts'
import { apiClient } from '@/lib/apiClient'

const collectionPath = (problemId: string) =>
  `/api/problems/${encodeURIComponent(problemId)}/statement-versions`

const versionPath = (problemId: string, versionId: string) =>
  `${collectionPath(problemId)}/${encodeURIComponent(versionId)}`

export const listProblemStatementVersions = (
  problemId: string,
  query: { page?: number; pageSize?: number } = {},
) => {
  const search = new URLSearchParams()
  if (query.page !== undefined) search.set('page', String(query.page))
  if (query.pageSize !== undefined) search.set('pageSize', String(query.pageSize))
  const suffix = search.size ? `?${search.toString()}` : ''
  return apiClient.queryContract(
    ProblemContracts.listStatementVersions,
    `${collectionPath(problemId)}${suffix}`,
  )
}

export const getProblemStatementVersion = (problemId: string, versionId: string) =>
  apiClient.queryContract(
    ProblemContracts.getStatementVersion,
    versionPath(problemId, versionId),
  )

export const createProblemStatementVersion = (
  problemId: string,
  body: ProblemStatementVersionCreateInput,
) => apiClient.mutateContract(
  ProblemContracts.createStatementVersion,
  collectionPath(problemId),
  body,
)

export const updateProblemStatementVersionContent = (
  problemId: string,
  versionId: string,
  body: ProblemStatementVersionContentInput,
) => apiClient.mutateContract(
  ProblemContracts.updateStatementVersionContent,
  `${versionPath(problemId, versionId)}/content`,
  body,
)

export const updateProblemStatementVersionMetadata = (
  problemId: string,
  versionId: string,
  body: ProblemStatementVersionMetadataInput,
) => apiClient.mutateContract(
  ProblemContracts.updateStatementVersionMetadata,
  versionPath(problemId, versionId),
  body,
)

export const deleteProblemStatementVersion = (problemId: string, versionId: string) =>
  apiClient.mutateContract(
    ProblemContracts.deleteStatementVersion,
    versionPath(problemId, versionId),
    {},
  )

export const uploadProblemStatementVersionPdf = (
  problemId: string,
  versionId: string,
  body: FormData,
) => apiClient.postFile<ProblemStatementVersion>(
  `${versionPath(problemId, versionId)}/pdf`,
  body,
  { timeout: 30_000 },
)

export const problemStatementVersionFileUrl = (problemId: string, versionId: string) =>
  `${versionPath(problemId, versionId)}/file`
