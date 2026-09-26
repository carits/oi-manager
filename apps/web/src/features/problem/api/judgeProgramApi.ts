import { ProblemContracts, type EndpointBody } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

const problemPath = (problemId: string) => `/api/problems/${encodeURIComponent(problemId)}`
const programPath = (problemId: string, programId: string) =>
  `${problemPath(problemId)}/judge-programs/${encodeURIComponent(programId)}`
const versionPath = (problemId: string, programId: string, versionId: string) =>
  `${programPath(problemId, programId)}/versions/${encodeURIComponent(versionId)}`

export const listJudgeProgramDrafts = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.listJudgeProgramDrafts,
    `${problemPath(problemId)}/judge-program-drafts`,
  )

export const saveJudgeProgramDraft = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.saveJudgeProgramDraft>,
) => apiClient.mutateContract(
  ProblemContracts.saveJudgeProgramDraft,
  `${problemPath(problemId)}/judge-program-drafts`,
  body,
)

export const updateJudgeProgramDraft = (
  problemId: string,
  draftId: string,
  body: EndpointBody<typeof ProblemContracts.updateJudgeProgramDraft>,
) => apiClient.mutateContract(
  ProblemContracts.updateJudgeProgramDraft,
  `${problemPath(problemId)}/judge-program-drafts/${encodeURIComponent(draftId)}`,
  body,
)

export const deleteJudgeProgramDraft = (problemId: string, draftId: string) =>
  apiClient.mutateContract(
    ProblemContracts.deleteJudgeProgramDraft,
    `${problemPath(problemId)}/judge-program-drafts/${encodeURIComponent(draftId)}`,
    {},
  )

export const listJudgePrograms = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.listJudgePrograms,
    `${problemPath(problemId)}/judge-programs`,
  )

export const listJudgeProgramAuditLogs = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.listJudgeProgramAuditLogs,
    `${problemPath(problemId)}/judge-program-audit-logs`,
  )

export const createJudgeProgram = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.createJudgeProgram>,
) => apiClient.mutateContract(
  ProblemContracts.createJudgeProgram,
  `${problemPath(problemId)}/judge-programs`,
  body,
)

export const createJudgeProgramVersion = (
  problemId: string,
  programId: string,
  body: EndpointBody<typeof ProblemContracts.createJudgeProgramVersion>,
) => apiClient.mutateContract(
  ProblemContracts.createJudgeProgramVersion,
  `${programPath(problemId, programId)}/versions`,
  body,
)

export const createJudgeProgramFixtureSet = (
  problemId: string,
  programId: string,
  body: EndpointBody<typeof ProblemContracts.createJudgeProgramFixtureSet>,
) => apiClient.mutateContract(
  ProblemContracts.createJudgeProgramFixtureSet,
  `${programPath(problemId, programId)}/fixture-sets`,
  body,
)

export const listJudgeProgramFixtureSets = (problemId: string, programId: string) =>
  apiClient.queryContract(
    ProblemContracts.listJudgeProgramFixtureSets,
    `${programPath(problemId, programId)}/fixture-sets`,
  )

export const compileJudgeProgramVersion = (
  problemId: string,
  programId: string,
  versionId: string,
) => apiClient.mutateContract(
  ProblemContracts.compileJudgeProgramVersion,
  `${versionPath(problemId, programId, versionId)}/compile`,
  {},
)

export const preflightJudgeProgramVersion = (
  problemId: string,
  programId: string,
  versionId: string,
  body: EndpointBody<typeof ProblemContracts.preflightJudgeProgramVersion>,
) => apiClient.mutateContract(
  ProblemContracts.preflightJudgeProgramVersion,
  `${versionPath(problemId, programId, versionId)}/preflight`,
  body,
)

export const getJudgeProgramVerification = (
  problemId: string,
  programId: string,
  versionId: string,
) => apiClient.queryContract(
  ProblemContracts.getJudgeProgramVerification,
  `${versionPath(problemId, programId, versionId)}/verification`,
)

export const updateJudgeProgram = (
  problemId: string,
  programId: string,
  body: EndpointBody<typeof ProblemContracts.updateJudgeProgram>,
) => apiClient.mutateContract(
  ProblemContracts.updateJudgeProgram,
  programPath(problemId, programId),
  body,
)

export const createValidatorSpec = (
  problemId: string,
  body: EndpointBody<typeof ProblemContracts.createValidatorSpec>,
) => apiClient.mutateContract(
  ProblemContracts.createValidatorSpec,
  `${problemPath(problemId)}/validator-specs`,
  body,
)

export const listValidatorSpecs = (problemId: string) =>
  apiClient.queryContract(
    ProblemContracts.listValidatorSpecs,
    `${problemPath(problemId)}/validator-specs`,
  )

export const activateValidatorSpec = (problemId: string, specId: string) =>
  apiClient.mutateContract(
    ProblemContracts.activateValidatorSpec,
    `${problemPath(problemId)}/validator-specs/${encodeURIComponent(specId)}/activate`,
    {},
  )

export const materializeValidatorSpec = (problemId: string, specId: string) =>
  apiClient.mutateContract(
    ProblemContracts.materializeValidatorSpec,
    `${problemPath(problemId)}/validator-specs/${encodeURIComponent(specId)}/materialize`,
    {},
  )
