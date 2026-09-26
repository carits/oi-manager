'use client'

import { useParams } from 'next/navigation'
import { ContestStatementManagementPage } from '@/features/contest/ContestStatementManagementPage'

export default function PersonalContestStatementsPage() {
  const { id } = useParams<{ id: string }>()
  return <ContestStatementManagementPage contestId={id} backPath={`/personal/contests/${id}`} />
}
