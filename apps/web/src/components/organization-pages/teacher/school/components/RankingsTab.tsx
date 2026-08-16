'use client'

import { MetricRankingWorkspace } from '@/components/ranking/MetricRankingWorkspace'

export default function RankingsTab() {
  return <MetricRankingWorkspace scope="campus" metric="rating" />
}
