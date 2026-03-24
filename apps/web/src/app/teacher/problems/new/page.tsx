'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ProblemForm } from '@/components/problem/ProblemForm'

export default function NewProblemPage() {
  return (
    <ProtectedRoute requiredRole="teacher">
      <ProblemForm mode="create" role="teacher" />
    </ProtectedRoute>
  )
}
