import { useEffect, useState, useCallback } from 'react'
import apiClient from '@/lib/apiClient'

export function useTrainingRank(trainingId: string, activeTab: string) {
  const [rankingData, setRankingData] = useState<any>(null)
  const [rankingLoading, setRankingLoading] = useState(false)
  const [rankingError, setRankingError] = useState<string | null>(null)

  const refreshRanking = useCallback(async () => {
    setRankingLoading(true)
    setRankingError(null)
    const res = await apiClient.get<any>(`/api/trainings/${trainingId}/ranking`)
    if (res.success && res.data) {
      setRankingData(res.data)
    } else {
      setRankingError(res.message || '加载排名失败')
    }
    setRankingLoading(false)
  }, [trainingId])

  useEffect(() => {
    if (activeTab !== 'ranking') {
      setRankingLoading(false)
      setRankingError(null)
      return
    }
    refreshRanking()
  }, [activeTab, refreshRanking])

  useEffect(() => {
    setRankingData(null)
  }, [trainingId])

  return {
    rankingData,
    rankingLoading,
    rankingError,
    refreshRanking,
  }
}
