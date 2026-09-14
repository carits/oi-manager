import {
  ProblemContracts,
  type ProblemTestGraphPairInput,
  type ProblemTestGraphSaveInput,
} from '@oi-manager/contracts'
import { apiClient } from '@/lib/apiClient'

const problemPath = (problemId: string) =>
  `/api/problems/${encodeURIComponent(problemId)}`

export const getProblemTestGraph = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.getTestGraph,
    `${problemPath(problemId)}/test-graph`,
  )

export const migrateProblemTestGraph = (problemId: string) =>
  apiClient.mutateContract(
    ProblemContracts.migrateTestGraph,
    `${problemPath(problemId)}/test-graph/migrate`,
    {},
  )

export const saveProblemTestGraph = (
  problemId: string,
  body: ProblemTestGraphSaveInput,
) => apiClient.mutateContract(
  ProblemContracts.saveTestGraph,
  `${problemPath(problemId)}/test-graph`,
  body,
)

export const registerProblemTestGraphTestcases = (
  problemId: string,
  pairs: ProblemTestGraphPairInput[],
) => apiClient.mutateContract(
  ProblemContracts.registerTestGraphTestcases,
  `${problemPath(problemId)}/test-graph/testcases`,
  { pairs },
)

export const setProblemTestGraphTestcaseProtection = (
  problemId: string,
  testcaseId: string,
  body: { isProtected: boolean; reason?: string },
) => apiClient.mutateContract(
  ProblemContracts.setTestcaseProtection,
  `${problemPath(problemId)}/test-graph/testcases/${encodeURIComponent(testcaseId)}/protection`,
  body,
)

export const getProblemTestSetRevision = (
  problemId: string,
  revisionId: string,
) => apiClient.queryContract(
  ProblemContracts.getTestSetRevision,
  `${problemPath(problemId)}/test-set-revisions/${encodeURIComponent(revisionId)}`,
)
