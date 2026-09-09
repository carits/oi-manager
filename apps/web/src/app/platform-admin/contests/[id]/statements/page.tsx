'use client'

import { useParams } from 'next/navigation'
import { TrainingStatementManagementPage } from '@/components/training/TrainingStatementManagementPage'

export default function PlatformAdminContestStatementsPage() {
  const { id } = useParams<{ id: string }>()
  return <TrainingStatementManagementPage trainingId={id} backPath={`/platform-admin/contests/${id}`} />
}
