'use client'

import { MetricRankingWorkspace } from '@/components/ranking/MetricRankingWorkspace'

export default function SolvedCountTab({ schoolId }: { schoolId: string }) {
  return <MetricRankingWorkspace scope="campus" metric="solved" schoolId={schoolId} />
}
