'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ProblemList } from '@/components/problem/ProblemList'

export default function TeacherProblemsPage() {
  return (
    <ProtectedRoute requiredRole="teacher">
      <ProblemList role="teacher" />
    </ProtectedRoute>
  )
}
