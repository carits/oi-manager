import {
  TrainingContracts,
  type TrainingStructureInput,
} from '@oi-manager/contracts'
import { apiClient } from '@/lib/apiClient'

const sessionPath = (sessionId: string) =>
  `/api/training-sessions/${encodeURIComponent(sessionId)}`

export const getTrainingDesign = (sessionId: string) =>
  apiClient.queryContract(TrainingContracts.getDesign, `${sessionPath(sessionId)}/design`)

export const validateTrainingDesign = (sessionId: string, body: TrainingStructureInput) =>
  apiClient.mutateContract(
    TrainingContracts.validateStructure,
    `${sessionPath(sessionId)}/structure/validate`,
    body,
  )

export const saveTrainingDesign = (sessionId: string, body: TrainingStructureInput) =>
  apiClient.mutateContract(
    TrainingContracts.replaceStructure,
    `${sessionPath(sessionId)}/structure`,
    body,
  )
