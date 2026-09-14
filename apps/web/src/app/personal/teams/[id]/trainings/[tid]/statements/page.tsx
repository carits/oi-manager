'use client'
import { useParams } from 'next/navigation'
import { TrainingStatementManagementPage } from '@/features/contest/TrainingStatementManagementPage'
export default function PersonalTrainingStatementsPage() {
  const { id, tid } = useParams<{ id: string; tid: string }>()
  return <TrainingStatementManagementPage trainingId={tid} backPath={`/personal/teams/${id}/trainings/${tid}`} />
}
