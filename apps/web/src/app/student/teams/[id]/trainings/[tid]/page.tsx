'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { TrainingDetailPage } from '@/components/training/TrainingDetailPage'

export default function StudentTrainingDetailPage() {
  return (
    <ProtectedRoute requiredRole="student">
      <TrainingDetailPage basePath="/student/teams" />
    </ProtectedRoute>
  )
}
