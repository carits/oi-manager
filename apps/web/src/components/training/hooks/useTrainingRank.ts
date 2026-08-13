import { useResource } from '@/hooks/useResource'

export function useTrainingRank(
  trainingId: string,
  activeTab: string,
  sessionKey: string | null,
) {
  const resource = useResource<any>(
    activeTab === 'ranking'
      ? `/api/trainings/${trainingId}/ranking`
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
