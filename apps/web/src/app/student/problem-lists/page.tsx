'use client'

import { useAuth } from '@/components/AuthProvider'
import ProblemListPage from '@/components/problem/ProblemListPage'

export default function StudentProblemListsPage() {
  const { user } = useAuth()
  return <ProblemListPage canCreate={user?.workspaceMode === 'personal'} displayMode="card" />
}
