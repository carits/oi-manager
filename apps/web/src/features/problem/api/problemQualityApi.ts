import { ProblemQualityContracts, type SolutionProfileCreateInput } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

const base = (problemId: string) => `/api/problems/${encodeURIComponent(problemId)}`

export const getProblemQualityDashboard = (problemId: string) =>
  apiClient.queryContract(ProblemQualityContracts.dashboard, `${base(problemId)}/quality`)

export const requestProblemQualityEvaluation = (problemId: string, revisionId: string) =>
  apiClient.mutateContract(ProblemQualityContracts.requestEvaluation, `${base(problemId)}/quality-evaluation-jobs`, { revisionId })

export const runAutomatedProblemQuality = (problemId: string) =>
  apiClient.mutateContract(ProblemQualityContracts.runAutomated, `${base(problemId)}/problem-quality-assessments/automated`, {})

export const submitExpertProblemQuality = (problemId: string, assessmentId: string, body: { algorithmicValueScore: number; editorialScore: number; originalityScore: number; comment: string }) =>
  apiClient.mutateContract(ProblemQualityContracts.submitExpert, `${base(problemId)}/problem-quality-assessments/${encodeURIComponent(assessmentId)}/expert-review`, body)

export const createProblemSolutionProfile = (problemId: string, body: SolutionProfileCreateInput) =>
  apiClient.mutateContract(ProblemQualityContracts.createSolutionProfile, `${base(problemId)}/solution-profiles`, body)

export const updateProblemSolutionProfile = (problemId: string, profileId: string, expectedRevision: number, status: 'active' | 'retired') =>
  apiClient.mutateContract(ProblemQualityContracts.updateSolutionProfile, `${base(problemId)}/solution-profiles/${encodeURIComponent(profileId)}`, { expectedRevision, status })
