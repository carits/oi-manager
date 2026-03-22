'use client'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { TeamDetailPage } from '@/components/team'

// 学生端 - 团队详情页
export default function StudentTeamDetailPage() {
  return (
    <ProtectedRoute requiredRole="student">
      <TeamDetailPage
        userType="student"
        basePath="/student/team"
        requiredRole="student"
      />
    </ProtectedRoute>
  )
}