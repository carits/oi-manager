'use client'

import { useParams } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ProblemForm } from '@/components/problem/ProblemForm'

export default function EditProblemPage() {
  const params = useParams()
  const problemId = params.id as string

  return (
    <ProtectedRoute requiredRole="platform_admin">
      <ProblemForm mode="edit" role="admin" problemId={problemId} />
    </ProtectedRoute>
  )
}