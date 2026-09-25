import { ContestRatingContracts, type ContestRatingData } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export function getContestRating(trainingId: number): Promise<ContestRatingData> {
  return apiClient.queryContract(
    ContestRatingContracts.detail,
    `/api/contests/${trainingId}/rating`,
  )
}
