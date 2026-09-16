'use client'

import { MetricRankingWorkspace } from '@/features/ranking'

export default function RankingsTab() {
  return <MetricRankingWorkspace scope="campus" metric="rating" />
}
