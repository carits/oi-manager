'use client'

import { useParams } from 'next/navigation'
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
import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/apiClient'
import { useAuth, type WorkspaceSummary } from '@/components/AuthProvider'

export default function OrgPage() {
  const { module } = useParams<{ module: string }>()
  const { user, activateOrganization } = useAuth()
  const { organizationId } = useParams<{ organizationId: string }>()
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
  if (!ready) return null
  if (module === 'overview') return student ? <StudentHome /> : <TeacherHome />
  if (module === 'campus') return student ? <StudentSchool /> : <TeacherSchool />
  if (module === 'students' && !student) return <StudentsPage />
  if (module === 'teachers' && !student) return <TeachersPage />
  if (module === 'teams') return student ? <StudentTeamPage /> : <TeamPage />
  if (module === 'homeworks') return student ? <StudentHomeworkPage /> : <TeacherHomeworkPage />
  if (module === 'contests') return student ? <StudentContestsPage /> : <TeacherContestsPage />
  if (module === 'problems' && !student) return <TeacherProblemsPage />
  if (module === 'problem-lists') return student ? <StudentProblemListsPage /> : <TeacherProblemListsPage />
  if (module === 'rankings') return student ? <StudentRankingsPage /> : <TeacherRankingsPage />
  return student ? <StudentHome /> : <TeacherHome />
}
