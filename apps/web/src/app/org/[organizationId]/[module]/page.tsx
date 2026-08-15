'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import TeacherHome from '@/app/teacher/page'
import StudentHome from '@/app/student/page'
import TeacherSchool from '@/app/teacher/school/page'
import StudentSchool from '@/app/student/school/page'
import StudentsPage from '@/app/teacher/students/page'
import TeachersPage from '@/app/teacher/teachers/page'
import TeamPage from '@/app/teacher/teams/page'
import StudentTeamPage from '@/app/student/team/page'
import TeacherHomeworkPage from '@/app/teacher/homeworks/page'
import StudentHomeworkPage from '@/app/student/homeworks/page'
import TeacherContestsPage from '@/app/teacher/contests/page'
import StudentContestsPage from '@/app/student/contests/page'
import TeacherProblemsPage from '@/app/teacher/problems/page'
import TeacherProblemListsPage from '@/app/teacher/problem-lists/page'
import StudentProblemListsPage from '@/app/student/problem-lists/page'
import TeacherRankingsPage from '@/app/teacher/rankings/page'
import StudentRankingsPage from '@/app/student/rating/page'
import { apiClient } from '@/lib/apiClient'
import { useAuth, type WorkspaceSummary } from '@/components/AuthProvider'
import { WalletPage } from '@/components/wallet/WalletPage'

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
    if (module === 'carits') router.replace('/org/' + organizationId + '/wallet')
    if (module === 'contributions') router.replace('/org/' + organizationId + '/rankings?tab=contribution')
  }, [module, organizationId, ready, router])

  if (!ready || module === 'carits' || module === 'contributions') return null
  if (module === 'overview') return student ? <StudentHome /> : <TeacherHome />
  if (module === 'campus') return student ? <StudentSchool /> : <TeacherSchool />
  if (module === 'students' && !student) return <StudentsPage />
  if (module === 'teachers' && !student) return <TeachersPage />
  if (module === 'teams') return student ? <StudentTeamPage /> : <TeamPage />
  if (module === 'homeworks') return student ? <StudentHomeworkPage /> : <TeacherHomeworkPage />
  if (module === 'contests') return student ? <StudentContestsPage /> : <TeacherContestsPage />
  if (module === 'problems' && !student) return <TeacherProblemsPage />
  if (module === 'problem-lists') return student ? <StudentProblemListsPage /> : <TeacherProblemListsPage />
  if (module === 'wallet' && !student) return <WalletPage scope="organization" endpoint={'/api/carits/organizations/' + organizationId + '/transactions'} />
  if (module === 'rankings') return student ? <StudentRankingsPage /> : <TeacherRankingsPage />
  return student ? <StudentHome /> : <TeacherHome />
}