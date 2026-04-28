'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { TrainingDetailPage } from '@/components/training/TrainingDetailPage'

export default function TeacherContestDetailPage() {
  return (
    <ProtectedRoute requiredRole={['teacher', 'school_principal']}>
      <TrainingDetailPage basePath="/teacher/teams" />
    </ProtectedRoute>
  )
}
