'use client'

import { useParams } from 'next/navigation'
import { ContestStatementManagementPage } from '@/features/contest/ContestStatementManagementPage'

export default function SuperAdminContestStatementsPage() {
  const { id } = useParams<{ id: string }>()
  return <ContestStatementManagementPage contestId={id} backPath={`/admin/contests/${id}`} />
}
