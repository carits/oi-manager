'use client'

import { MetricRankingWorkspace, type RankingMetric } from '@/features/ranking'

export default function PersonalRankingsTab({ type }: { type: RankingMetric }) {
  return <MetricRankingWorkspace scope="personal" metric={type} />
}
