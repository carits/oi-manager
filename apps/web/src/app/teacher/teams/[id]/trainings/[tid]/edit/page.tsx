'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { TrainingEditPage } from '@/components/training/TrainingEditPage'

export default function TeacherTrainingEditPage() {
  return (
    <ProtectedRoute requiredRole={['teacher', 'school_principal']}>
      <TrainingEditPage basePath="/teacher/teams" />
    </ProtectedRoute>
  )
}