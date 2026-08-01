'use client'

import { TeamDetailPage } from '@/components/team/TeamDetailPage'

export default function PersonalTeamDetailPage() {
  return <TeamDetailPage userType="user" basePath="/personal/teams" requiredRole={['super_admin', 'platform_admin', 'school_principal', 'teacher', 'student']} />
}
