'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { TeamDetailPage } from '@/components/team'

// 教师端 - 团队详情页
export default function TeacherTeamDetailPage() {
  return (
    <ProtectedRoute requiredRole={['teacher', 'school_principal']}>
      <TeamDetailPage
        userType="teacher"
        basePath="/teacher/teams"
        requiredRole={['teacher', 'school_principal']}
      />
    </ProtectedRoute>
  )
}
