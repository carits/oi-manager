import { useResource } from '@/hooks/useResource'
import type { ComponentProps } from 'react'
import type { ContestRankTable } from '../ui/components/ContestRankTable'

type ContestRankingData = ComponentProps<typeof ContestRankTable>['rankingData']

export function useContestRank(
  contestId: string,
  activeTab: string,
  sessionKey: string | null,
) {
  const resource = useResource<ContestRankingData>(
    activeTab === 'ranking'
      ? `/api/contests/${contestId}/ranking`
      : null,
    {
      dedupingInterval: 5000,
      refreshInterval: 5000,
      isEmpty: () => false,
      sessionKey,
    },
  )

  const rankingData =
    resource.data ??
    (resource.state.state === 'error' ? resource.state.previousData : undefined)

  return {
    rankingData: rankingData ?? null,
    rankingState: resource.state,
    refreshRanking: resource.retry,
  }
}
