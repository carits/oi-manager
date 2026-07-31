'use client'

import { TeamDetailPage } from '@/components/team/TeamDetailPage'

// 教师端 - 团队详情页
export default function TeacherTeamDetailPage() {
  return (
    <>
      <TeamDetailPage
        userType="teacher"
        basePath="/teacher/teams"
        requiredRole={['teacher', 'school_principal']}
      />
    </>
  )
}
