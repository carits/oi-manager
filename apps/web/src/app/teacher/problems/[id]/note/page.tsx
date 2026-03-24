'use client'

import { useParams } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ProblemNote } from '@/components/problem/ProblemNote'

export default function TeacherProblemNotePage() {
  const params = useParams()
  const problemId = params.id as string

  return (
    <ProtectedRoute requiredRole="teacher">
      <ProblemNote role="teacher" problemId={problemId} />
    </ProtectedRoute>
  )
}