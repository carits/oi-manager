import { useResource } from '@/hooks/useResource'
import type { ComponentProps } from 'react'
import type { TrainingRankTable } from '../ui/components/TrainingRankTable'

type TrainingRankingData = ComponentProps<typeof TrainingRankTable>['rankingData']

export function useTrainingRank(
  trainingId: string,
  activeTab: string,
  sessionKey: string | null,
) {
  const resource = useResource<TrainingRankingData>(
    activeTab === 'ranking'
      ? `/api/contests/${trainingId}/ranking`
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
