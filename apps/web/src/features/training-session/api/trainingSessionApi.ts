import {
  TrainingContracts,
  type EndpointBody,
  type TrainingStructureInput,
} from '@oi-manager/contracts'
import { apiClient } from '@/lib/apiClient'

const sessionPath = (sessionId: string) =>
  `/api/training-sessions/${encodeURIComponent(sessionId)}`

export const getTrainingDesign = (sessionId: string) =>
  apiClient.queryContract(TrainingContracts.getDesign, `${sessionPath(sessionId)}/design`)

export const getTrainingDesignProblem = (sessionId: string, problemId: string) =>
  apiClient.queryContract(TrainingContracts.getDesignProblem, `${sessionPath(sessionId)}/design-problems/${encodeURIComponent(problemId)}`)

export const validateTrainingDesign = (sessionId: string, body: TrainingStructureInput) =>
  apiClient.mutateContract(
    TrainingContracts.validateStructure,
    `${sessionPath(sessionId)}/structure/validate`,
    body,
  )

export const saveTrainingStageGroupMatrix = (sessionId: string, body: EndpointBody<typeof TrainingContracts.replaceStageGroupMatrix>) =>
  apiClient.mutateContract(TrainingContracts.replaceStageGroupMatrix, `${sessionPath(sessionId)}/stage-group-matrix`, body)

export const splitTrainingGroup = (sessionId: string, body: EndpointBody<typeof TrainingContracts.splitGroup>) =>
  apiClient.mutateContract(TrainingContracts.splitGroup, `${sessionPath(sessionId)}/groups/split`, body)

export const mergeTrainingGroup = (sessionId: string, body: EndpointBody<typeof TrainingContracts.mergeGroup>) =>
  apiClient.mutateContract(TrainingContracts.mergeGroup, `${sessionPath(sessionId)}/groups/merge`, body)

export const saveTrainingDesign = (sessionId: string, body: TrainingStructureInput) =>
  apiClient.mutateContract(
    TrainingContracts.replaceStructure,
    `${sessionPath(sessionId)}/structure`,
    body,
  )

export const publishTraining = (sessionId: string, body: EndpointBody<typeof TrainingContracts.publish>) =>
  apiClient.mutateContract(TrainingContracts.publish, `${sessionPath(sessionId)}/publish`, body)

export const getTrainingWorkspace = (sessionId: string) =>
  apiClient.queryContract(TrainingContracts.getWorkspace, sessionPath(sessionId))

export const getTrainingRoster = (sessionId: string) =>
  apiClient.queryContract(TrainingContracts.getRoster, `${sessionPath(sessionId)}/roster`)

export const saveTrainingRoster = (sessionId: string, body: EndpointBody<typeof TrainingContracts.replaceRoster>) =>
  apiClient.mutateContract(TrainingContracts.replaceRoster, `${sessionPath(sessionId)}/roster`, body)

export const joinTrainingParticipantRuntime = (sessionId: string, body: EndpointBody<typeof TrainingContracts.joinParticipantRuntime>) =>
  apiClient.mutateContract(TrainingContracts.joinParticipantRuntime, `${sessionPath(sessionId)}/runtime-participants`, body)

export const leaveTrainingParticipantRuntime = (sessionId: string, participantId: string, body: EndpointBody<typeof TrainingContracts.leaveParticipantRuntime>) =>
  apiClient.mutateContract(TrainingContracts.leaveParticipantRuntime, `${sessionPath(sessionId)}/runtime-participants/${encodeURIComponent(participantId)}/leave`, body)

export const getTrainingCoachDashboard = (sessionId: string) =>
  apiClient.queryContract(TrainingContracts.getCoachDashboard, `${sessionPath(sessionId)}/coach-dashboard`)

export const getTrainingReport = (sessionId: string) =>
  apiClient.queryContract(TrainingContracts.getReport, `${sessionPath(sessionId)}/report`)

export const transitionTrainingStage = (sessionId: string, body: EndpointBody<typeof TrainingContracts.transitionStage>) =>
  apiClient.mutateContract(TrainingContracts.transitionStage, `${sessionPath(sessionId)}/stage-transitions`, body)

export const putTrainingNextStage = (sessionId: string, body: EndpointBody<typeof TrainingContracts.putNextStage>) =>
  apiClient.mutateContract(TrainingContracts.putNextStage, sessionPath(sessionId) + '/next-stage', body)

export const deleteTrainingNextStage = (sessionId: string, body: EndpointBody<typeof TrainingContracts.deleteNextStage>) =>
  apiClient.mutateContract(TrainingContracts.deleteNextStage, sessionPath(sessionId) + '/next-stage', body)

export const changeTrainingStageGroup = (sessionId: string, stageId: string, body: EndpointBody<typeof TrainingContracts.changeStageGroup>) =>
  apiClient.mutateContract(TrainingContracts.changeStageGroup, `${sessionPath(sessionId)}/stages/${encodeURIComponent(stageId)}/group-changes`, body)

export const extendTrainingStageTime = (sessionId: string, stageId: string, body: EndpointBody<typeof TrainingContracts.extendStageTime>) =>
  apiClient.mutateContract(TrainingContracts.extendStageTime, `${sessionPath(sessionId)}/stages/${encodeURIComponent(stageId)}/time-extensions`, body)

export const appendTrainingRuntimeProblem = (sessionId: string, stageId: string, body: EndpointBody<typeof TrainingContracts.appendRuntimeProblem>) =>
  apiClient.mutateContract(TrainingContracts.appendRuntimeProblem, `${sessionPath(sessionId)}/stages/${encodeURIComponent(stageId)}/runtime-problems`, body)

export const getTrainingGroupSuggestions = (sessionId: string, stageId: string) =>
  apiClient.queryContract(TrainingContracts.getGroupSuggestions, `${sessionPath(sessionId)}/stages/${encodeURIComponent(stageId)}/group-suggestions`)

export const listTrainingSessions = (query: Record<string, string | undefined>) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value)
  return apiClient.queryContract(TrainingContracts.listSessions, `/api/training-sessions?${params}`)
}

export const createTrainingSession = (body: EndpointBody<typeof TrainingContracts.createSession>) =>
  apiClient.mutateContract(TrainingContracts.createSession, '/api/training-sessions', body)

export const cloneTrainingSession = (sessionId: string, body: EndpointBody<typeof TrainingContracts.cloneSession>) =>
  apiClient.mutateContract(TrainingContracts.cloneSession, sessionPath(sessionId) + '/clone', body)

export const previewTrainingParticipants = (body: EndpointBody<typeof TrainingContracts.previewParticipants>) =>
  apiClient.mutateContract(TrainingContracts.previewParticipants, '/api/training-sessions/participant-preview', body)

export const joinTrainingSession = (sessionId: string) =>
  apiClient.mutateContract(TrainingContracts.joinSession, `${sessionPath(sessionId)}/join`, {})

export const executeTrainingCommand = (sessionId: string, body: EndpointBody<typeof TrainingContracts.executeCommand>) =>
  apiClient.mutateContract(TrainingContracts.executeCommand, `${sessionPath(sessionId)}/commands`, body)

export const sendTrainingHeartbeat = (sessionId: string, body: EndpointBody<typeof TrainingContracts.heartbeat>) =>
  apiClient.mutateContract(TrainingContracts.heartbeat, `${sessionPath(sessionId)}/heartbeat`, body)

export const getTrainingDraft = (sessionId: string, stageProblemId: string) =>
  apiClient.queryContract(TrainingContracts.getDraft, `${sessionPath(sessionId)}/drafts/${encodeURIComponent(stageProblemId)}`)

export const saveTrainingDraft = (sessionId: string, stageProblemId: string, body: EndpointBody<typeof TrainingContracts.saveDraft>, options: { keepalive?: boolean } = {}) =>
  apiClient.mutateContract(TrainingContracts.saveDraft, `${sessionPath(sessionId)}/drafts/${encodeURIComponent(stageProblemId)}`, body, options)

export const submitTrainingSolution = (sessionId: string, body: EndpointBody<typeof TrainingContracts.submit>) =>
  apiClient.mutateContract(TrainingContracts.submit, `${sessionPath(sessionId)}/submit`, body)

export const createTrainingHint = (sessionId: string, body: EndpointBody<typeof TrainingContracts.createHint>) =>
  apiClient.mutateContract(TrainingContracts.createHint, `${sessionPath(sessionId)}/hints`, body)

export const updateTrainingHint = (sessionId: string, hintId: string, body: EndpointBody<typeof TrainingContracts.updateHint>) =>
  apiClient.mutateContract(TrainingContracts.updateHint, `${sessionPath(sessionId)}/hints/${encodeURIComponent(hintId)}`, body)

export const deleteTrainingHint = (sessionId: string, hintId: string) =>
  apiClient.mutateContract(TrainingContracts.deleteHint, `${sessionPath(sessionId)}/hints/${encodeURIComponent(hintId)}`, undefined)

export const listTrainingHints = (sessionId: string, stageProblemId: string) =>
  apiClient.queryContract(TrainingContracts.listHints, `${sessionPath(sessionId)}/problems/${encodeURIComponent(stageProblemId)}/hints`)

export const openTrainingHint = (sessionId: string, hintId: string) =>
  apiClient.mutateContract(TrainingContracts.openHint, `${sessionPath(sessionId)}/hints/${encodeURIComponent(hintId)}/open`, {})

export const recordTrainingStrategy = (sessionId: string, body: EndpointBody<typeof TrainingContracts.recordStrategy>) =>
  apiClient.mutateContract(TrainingContracts.recordStrategy, `${sessionPath(sessionId)}/strategy-decisions`, body)

export const getTrainingPeerProgress = (sessionId: string) =>
  apiClient.queryContract(TrainingContracts.getPeerProgress, `${sessionPath(sessionId)}/peer-progress`)

// Cross-feature reads remain centralized here so Training UI/Model never talks
// to transport directly. These endpoints are migrated with their owning slices.
export const getTrainingProblemDetail = <T>(problemId: string) =>
  apiClient.get<T>(`/api/problems/${encodeURIComponent(problemId)}`)

export const listManagedTrainingTeams = <T>(query: URLSearchParams) =>
  apiClient.get<T>(`/api/teams?${query}`)

export const listTrainingTemplates = (query: { organizationId?: string; teamId?: string } = {}) => {
  const params = new URLSearchParams()
  if (query.organizationId) params.set('organizationId', query.organizationId)
  if (query.teamId) params.set('teamId', query.teamId)
  return apiClient.queryContract(TrainingContracts.listTemplates, `/api/training-session-templates${params.size ? `?${params}` : ''}`)
}

export const createTrainingTemplate = (sessionId: string, body: EndpointBody<typeof TrainingContracts.createTemplate>) =>
  apiClient.mutateContract(TrainingContracts.createTemplate, `${sessionPath(sessionId)}/templates`, body)

export const deleteTrainingTemplate = (templateId: string) =>
  apiClient.mutateContract(TrainingContracts.deleteTemplate, `/api/training-session-templates/${encodeURIComponent(templateId)}`, undefined)
