'use client'

import { MetricRankingWorkspace } from '@/components/ranking/MetricRankingWorkspace'

export default function RankingsTab({ schoolId }: { schoolId: string }) {
  return <MetricRankingWorkspace scope="campus" metric="rating" schoolId={schoolId} />
}
