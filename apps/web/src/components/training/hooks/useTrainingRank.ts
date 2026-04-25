import { useEffect, useState, useCallback } from 'react'
import apiClient from '@/lib/apiClient'

export function useTrainingRank(trainingId: string, activeTab: string) {
  const [rankingData, setRankingData] = useState<any>(null)

  const refreshRanking = useCallback(async () => {
    try {
      const res = await apiClient.get<any>(`/api/trainings/${trainingId}/ranking`)
      if (res.success && res.data) {
        setRankingData(res.data)
      }
    } catch (error) {
      console.error('Failed to load ranking:', error)
    }
  }, [trainingId])

  useEffect(() => {
    if (activeTab !== 'ranking') {
      setRankingData(null)
      return
    }
    refreshRanking()
  }, [activeTab, trainingId, refreshRanking])

  return { rankingData, refreshRanking }
}
