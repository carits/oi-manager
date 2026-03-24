'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ProblemForm } from '@/components/problem/ProblemForm'

export default function NewProblemPage() {
  return (
    <ProtectedRoute requiredRole="platform_admin">
      <ProblemForm mode="create" role="admin" />
    </ProtectedRoute>
  )
}