'use client'

import { useParams } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ProblemNote } from '@/components/problem/ProblemNote'

export default function ProblemNotePage() {
  const params = useParams()
  const problemId = params.id as string

  return (
    <ProtectedRoute requiredRole="student">
      <ProblemNote role="student" problemId={problemId} />
    </ProtectedRoute>
  )
}
