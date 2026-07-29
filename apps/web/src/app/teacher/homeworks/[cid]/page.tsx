'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { TrainingDetailPage } from '@/components/training/TrainingDetailPage'

export default function TeacherHomeworkDetailPage() {
  return (
    <ProtectedRoute requiredRole="teacher">
      <TrainingDetailPage basePath="/teacher" />
    </ProtectedRoute>
  )
}
