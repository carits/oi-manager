'use client'

import { useParams } from 'next/navigation'
import { TrainingStatementManagementPage } from '@/features/contest/TrainingStatementManagementPage'

export default function PersonalContestStatementsPage() {
  const { id } = useParams<{ id: string }>()
  return <TrainingStatementManagementPage trainingId={id} backPath={`/personal/contests/${id}`} />
}
