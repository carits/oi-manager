'use client'
import { useParams } from 'next/navigation'
import { TrainingStatementManagementPage } from '@/components/training/TrainingStatementManagementPage'
export default function PersonalContestStatementsPage() {
  const { cid } = useParams<{ cid: string }>()
  return <TrainingStatementManagementPage trainingId={cid} />
}
