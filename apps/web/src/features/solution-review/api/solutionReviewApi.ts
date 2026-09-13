import { SolutionReviewContracts, type SimilarityComparison } from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export function getSimilarityComparison(contributionId: string): Promise<SimilarityComparison> {
  return apiClient.queryContract(
    SolutionReviewContracts.similarityComparison,
    `/api/review/solution-contributions/${encodeURIComponent(contributionId)}/similarity-comparison`,
  )
}
