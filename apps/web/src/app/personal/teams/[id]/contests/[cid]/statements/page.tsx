'use client'
import { useParams } from 'next/navigation'
import { TrainingStatementManagementPage } from '@/components/training/TrainingStatementManagementPage'
export default function PersonalContestStatementsPage() {
  const { id, cid } = useParams<{ id: string; cid: string }>()
  return <TrainingStatementManagementPage trainingId={cid} backPath={`/personal/teams/${id}/contests/${cid}`} />
}
