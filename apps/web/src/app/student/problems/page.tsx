'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ProblemList } from '@/components/problem/ProblemList'

export default function StudentProblemsPage() {
  return (
    <ProtectedRoute requiredRole="student">
      <ProblemList role="student" />
    </ProtectedRoute>
  )
}
