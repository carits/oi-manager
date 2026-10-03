import { TrainingContracts } from '@oi-manager/contracts'
import type { EndpointBody } from '@oi-manager/contracts'
import { apiClient } from '@/lib/apiClient'

const sessionPath = (sessionId: string) => `/api/training-sessions/${encodeURIComponent(sessionId)}`

export const getTrainingWorkspace = (sessionId: string) =>
  apiClient.queryContract(TrainingContracts.getWorkspace, sessionPath(sessionId))

export const listTrainingSessions = (query: Record<string, string | undefined>) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value)
  return apiClient.queryContract(TrainingContracts.listSessions, `/api/training-sessions?${params}`)
}

export const createTrainingSession = (body: EndpointBody<typeof TrainingContracts.createSession>) =>
  apiClient.mutateContract(TrainingContracts.createSession, '/api/training-sessions', body)

export const previewTrainingParticipants = (body: EndpointBody<typeof TrainingContracts.previewParticipants>) =>
  apiClient.mutateContract(TrainingContracts.previewParticipants, '/api/training-sessions/participant-preview', body)

export const replaceTrainingAssignments = (sessionId: string, body: EndpointBody<typeof TrainingContracts.replaceAssignments>) =>
  apiClient.mutateContract(TrainingContracts.replaceAssignments, `${sessionPath(sessionId)}/assignments`, body)

export const putTrainingNextRound = (sessionId: string, body: EndpointBody<typeof TrainingContracts.putNextRound>) =>
  apiClient.mutateContract(TrainingContracts.putNextRound, `${sessionPath(sessionId)}/next-round`, body)

export const deleteTrainingNextRound = (sessionId: string, body: EndpointBody<typeof TrainingContracts.deleteNextRound>) =>
  apiClient.mutateContract(TrainingContracts.deleteNextRound, `${sessionPath(sessionId)}/next-round`, body)

export const advanceTrainingRound = (sessionId: string, body: EndpointBody<typeof TrainingContracts.advanceRound>) =>
  apiClient.mutateContract(TrainingContracts.advanceRound, `${sessionPath(sessionId)}/rounds/advance`, body)

export const replaceTrainingGrouping = (sessionId: string, body: EndpointBody<typeof TrainingContracts.replaceGrouping>) =>
  apiClient.mutateContract(TrainingContracts.replaceGrouping, `${sessionPath(sessionId)}/grouping`, body)

export const changeTrainingGrouping = (sessionId: string, body: EndpointBody<typeof TrainingContracts.changeGrouping>) =>
  apiClient.mutateContract(TrainingContracts.changeGrouping, `${sessionPath(sessionId)}/grouping/change`, body)

export const joinTrainingSession = (sessionId: string) =>
  apiClient.mutateContract(TrainingContracts.joinSession, `${sessionPath(sessionId)}/join`, {})

export const executeTrainingCommand = (sessionId: string, body: EndpointBody<typeof TrainingContracts.executeCommand>) =>
  apiClient.mutateContract(TrainingContracts.executeCommand, `${sessionPath(sessionId)}/commands`, body)

export const archiveTrainingSession = (sessionId: string, body: EndpointBody<typeof TrainingContracts.archiveSession>) =>
  apiClient.mutateContract(TrainingContracts.archiveSession, `${sessionPath(sessionId)}/archive`, body)

export const sendTrainingHeartbeat = (sessionId: string, body: EndpointBody<typeof TrainingContracts.heartbeat>) =>
  apiClient.mutateContract(TrainingContracts.heartbeat, `${sessionPath(sessionId)}/heartbeat`, body)

export const getTrainingDraft = (sessionId: string, sessionProblemId: string) =>
  apiClient.queryContract(TrainingContracts.getDraft, `${sessionPath(sessionId)}/drafts/${encodeURIComponent(sessionProblemId)}`)

export const saveTrainingDraft = (sessionId: string, sessionProblemId: string, body: EndpointBody<typeof TrainingContracts.saveDraft>, options: { keepalive?: boolean } = {}) =>
  apiClient.mutateContract(TrainingContracts.saveDraft, `${sessionPath(sessionId)}/drafts/${encodeURIComponent(sessionProblemId)}`, body, options)

export const submitTrainingSolution = (sessionId: string, body: EndpointBody<typeof TrainingContracts.submit>) =>
  apiClient.mutateContract(TrainingContracts.submit, `${sessionPath(sessionId)}/submit`, body)

export const getTrainingCoachDashboard = (sessionId: string) =>
  apiClient.queryContract(TrainingContracts.getCoachDashboard, `${sessionPath(sessionId)}/coach-dashboard`)

export const getTrainingReport = (sessionId: string) =>
  apiClient.queryContract(TrainingContracts.getReport, `${sessionPath(sessionId)}/report`)

export const getTrainingPeerProgress = (sessionId: string) =>
  apiClient.queryContract(TrainingContracts.getPeerProgress, `${sessionPath(sessionId)}/peer-progress`)

export const trainingEventStreamUrl = (sessionId: string, organizationId?: string | null) => {
  const query = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ''
  return `${sessionPath(sessionId)}/events${query}`
}

export const getTrainingProblemDetail = <T>(problemId: string) =>
  apiClient.get<T>(`/api/problems/${encodeURIComponent(problemId)}`)

export const listManagedTrainingTeams = <T>(query: URLSearchParams) =>
  apiClient.get<T>(`/api/teams?${query}`)
