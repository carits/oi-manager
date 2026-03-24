'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ProblemForm } from '@/components/problem/ProblemForm'

export default function NewProblemPage() {
  return (
    <ProtectedRoute requiredRole="student">
      <ProblemForm mode="create" role="student" />
    </ProtectedRoute>
  )
}
