'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { TrainingDetailPage } from '@/components/training/TrainingDetailPage'

export default function StudentHomeworkDetailPage() {
  return (
    <ProtectedRoute requiredRole="student">
      <TrainingDetailPage basePath="/student" />
    </ProtectedRoute>
  )
}
