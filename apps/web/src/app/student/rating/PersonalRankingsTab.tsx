'use client'

import { MetricRankingWorkspace, type RankingMetric } from '@/components/ranking/MetricRankingWorkspace'

export default function PersonalRankingsTab({ type }: { type: RankingMetric }) {
  return <MetricRankingWorkspace scope="personal" metric={type} />
}
