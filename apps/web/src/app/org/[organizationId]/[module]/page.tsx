'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import TeacherHome from '@/components/organization-pages/teacher/page'
import StudentHome from '@/components/organization-pages/student/page'
import OrganizationCampusPage from '@/components/campus/OrganizationCampusPage'
import TeamPage from '@/components/organization-pages/teacher/teams/page'
import StudentTeamPage from '@/components/organization-pages/student/team/page'
import TeacherHomeworkPage from '@/components/organization-pages/teacher/homeworks/page'
import StudentHomeworkPage from '@/components/organization-pages/student/homeworks/page'
import TeacherContestsPage from '@/components/organization-pages/teacher/contests/page'
import StudentContestsPage from '@/components/organization-pages/student/contests/page'
import TeacherProblemsPage from '@/components/organization-pages/teacher/problems/page'
import TeacherProblemListsPage from '@/components/organization-pages/teacher/problem-lists/page'
import StudentProblemListsPage from '@/components/organization-pages/student/problem-lists/page'
import TeacherRankingsPage from '@/components/organization-pages/teacher/rankings/page'
import CampusManagementPage from '@/components/organization-pages/teacher/management/page'
import StudentRankingsPage from '@/components/organization-pages/student/rating/page'
import { apiClient } from '@/lib/apiClient'
import { useAuth, type WorkspaceSummary } from '@/components/AuthProvider'

export default function OrgPage() {
  const { module, organizationId } = useParams<{ module: string; organizationId: string }>()
  const router = useRouter()
  const { user, activateOrganization } = useAuth()
  const [workspaceRole, setWorkspaceRole] = useState<'school_principal' | 'teacher' | 'student' | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(false)
    void apiClient.get<{ workspaces: WorkspaceSummary[] }>('/api/workspaces').then(result => {
      const workspace = result.data?.workspaces.find(item => item.organizationId === organizationId)
      if (result.success && workspace?.type === 'organization') {
        activateOrganization(workspace)
        setWorkspaceRole(workspace.memberRole as 'school_principal' | 'teacher' | 'student')
      }
      setReady(true)
    })
  }, [activateOrganization, organizationId])

  const student = (workspaceRole || user?.organizationRole) === 'student'

  useEffect(() => {
    if (!ready) return
    const legacyTarget: Record<string, string> = {
      carits: '/org/' + organizationId + '/management?tab=wallet',
      contributions: '/org/' + organizationId + '/rankings?tab=contribution',
      students: '/org/' + organizationId + '/management?tab=students',
      teachers: '/org/' + organizationId + '/management?tab=teachers',
      wallet: '/org/' + organizationId + '/management?tab=wallet',
    }
    if (legacyTarget[module]) router.replace(legacyTarget[module])
  }, [module, organizationId, ready, router])

  if (!ready || ['carits', 'contributions', 'students', 'teachers', 'wallet'].includes(module)) return null
  if (module === 'overview') return student ? <StudentHome /> : <TeacherHome />
  if (module === 'campus') return <OrganizationCampusPage />
  if (module === 'management' && !student) return <CampusManagementPage />
  if (module === 'teams') return student ? <StudentTeamPage /> : <TeamPage />
  if (module === 'homeworks') return student ? <StudentHomeworkPage /> : <TeacherHomeworkPage />
  if (module === 'contests') return student ? <StudentContestsPage /> : <TeacherContestsPage />
  if (module === 'problems' && !student) return <TeacherProblemsPage />
  if (module === 'problem-lists') return student ? <StudentProblemListsPage /> : <TeacherProblemListsPage />
  if (module === 'rankings') return student ? <StudentRankingsPage /> : <TeacherRankingsPage />
  return student ? <StudentHome /> : <TeacherHome />
}