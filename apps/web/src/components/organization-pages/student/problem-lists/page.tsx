'use client'

import { usePathname } from 'next/navigation'
import { currentWorkspacePrefix, isPersonalPath } from '@/lib/workspacePath'
import ProblemListPage from '@/components/problem/ProblemListPage'

export default function StudentProblemListsPage() {
  const pathname = usePathname()
  return <ProblemListPage canCreate={isPersonalPath(pathname)} displayMode="card" />
}
