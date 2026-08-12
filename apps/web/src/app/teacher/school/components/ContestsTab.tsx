'use client'

import { useAuth } from '@/components/AuthProvider'
import TeamTrainingList from '@/components/training/TeamTrainingList'

interface ContestsTabProps {
  schoolId: string
}

export default function ContestsTab({ schoolId }: ContestsTabProps) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'super_admin' || user?.role === 'school_principal'

  return (
    <TeamTrainingList
      schoolId={schoolId}
      basePath="/teacher/school"
      isAdmin={isAdmin}
      mode="contest"
      schoolRole="teacher"
    />
  )
}
