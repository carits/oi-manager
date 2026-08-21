'use client'
import { useParams } from 'next/navigation'
import { TrainingStatementManagementPage } from '@/components/training/TrainingStatementManagementPage'
export default function PersonalTrainingStatementsPage() {
  const { tid } = useParams<{ tid: string }>()
  return <TrainingStatementManagementPage trainingId={tid} />
}
