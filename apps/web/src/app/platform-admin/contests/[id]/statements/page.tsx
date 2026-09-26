'use client'

import { useParams } from 'next/navigation'
import { ContestStatementManagementPage } from '@/features/contest/ContestStatementManagementPage'

export default function PlatformAdminContestStatementsPage() {
  const { id } = useParams<{ id: string }>()
  return <ContestStatementManagementPage contestId={id} backPath={`/platform-admin/contests/${id}`} />
}
