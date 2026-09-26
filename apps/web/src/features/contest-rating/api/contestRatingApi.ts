import { ContestRatingContracts, type ContestRatingData, type ContestRatingParticipation } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export function getContestRating(trainingId: number): Promise<ContestRatingData> {
  return apiClient.queryContract(
    ContestRatingContracts.detail,
    `/api/contests/${trainingId}/rating`,
  )
}

export function getContestRatingParticipation(trainingId: number): Promise<ContestRatingParticipation> {
  return apiClient.queryContract(ContestRatingContracts.participation, `/api/contests/${trainingId}/rating-participation`)
}

export function updateContestRatingParticipation(trainingId: number, organizationId: string | null) {
  return apiClient.mutateContract(ContestRatingContracts.updateParticipation, `/api/contests/${trainingId}/rating-participation`, { organizationId })
}

export function finalizeContestRating(trainingId: number) {
  return apiClient.mutateContract(ContestRatingContracts.finalize, `/api/contests/${trainingId}/finalize`, {})
}

export function rebuildContestRating(trainingId: number) {
  return apiClient.mutateContract(ContestRatingContracts.rebuild, `/api/contests/${trainingId}/rating/rebuild`, {})
}
