'use client'

import { TeamDetailPage } from '@/components/team/TeamDetailPage'

// 学生端 - 团队详情页
export default function StudentTeamDetailPage() {
  return (
    <>
      <TeamDetailPage
        userType="student"
        basePath="/student/team"
        requiredRole="student"
      />
    </>
  )
}