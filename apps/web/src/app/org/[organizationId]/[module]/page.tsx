'use client'

import { useEffect, useState } from 'react'
import unifiedStyles from './page.unified.module.css'
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
import { TrainingSessionListPage } from '@/components/training-engine/TrainingSessionListPage'
import { SubmissionList } from '@/components/submission/SubmissionList'
import { apiClient } from '@/lib/apiClient'
import { useAuth, type WorkspaceSummary } from '@/components/AuthProvider'

const studentModules = new Set(['overview', 'campus', 'teams', 'homeworks', 'contests', 'training-sessions', 'problem-lists', 'rankings', 'submissions'])

export default function OrgPage() {
  const { module, organizationId } = useParams<{ module: string; organizationId: string }>()
  const router = useRouter()
  const { user, activateOrganization } = useAuth()
  const [workspaceRole, setWorkspaceRole] = useState<'school_principal' | 'teacher' | 'student' | null>(null)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    setReady(false)
    setLoadError(null)
    void apiClient.get<{ workspaces: WorkspaceSummary[] }>('/api/workspaces').then(result => {
      const workspace = result.data?.workspaces.find(item => item.organizationId === organizationId)
      if (result.success && workspace?.type === 'organization') {
        activateOrganization(workspace)
        setWorkspaceRole(workspace.memberRole as 'school_principal' | 'teacher' | 'student')
      } else if (user?.organizationId === organizationId && user.organizationRole) {
        setWorkspaceRole(user.organizationRole)
      } else {
        setLoadError(result.message || '当前账号没有该校园的有效成员关系')
      }
      setReady(true)
    }).catch(() => {
      if (user?.organizationId === organizationId && user.organizationRole) setWorkspaceRole(user.organizationRole)
      else setLoadError('校园工作区暂时无法加载，请刷新后重试')
      setReady(true)
    })
  }, [activateOrganization, organizationId, user?.organizationId, user?.organizationRole])

  const student = (workspaceRole || user?.organizationRole) === 'student'
  const studentModuleAllowed = !student || studentModules.has(module)

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

  useEffect(() => {
    if (ready && student && !studentModuleAllowed) {
      router.replace(`/org/${organizationId}/overview`)
    }
  }, [module, organizationId, ready, router, student, studentModuleAllowed])

  if (!ready || !studentModuleAllowed || ['carits', 'contributions', 'students', 'teachers', 'wallet'].includes(module)) return null
  if (loadError && !workspaceRole) return <main className={unifiedStyles.u1}><h1>校园工作区无法打开</h1><p>{loadError}</p></main>
  if (module === 'overview') return student ? <StudentHome /> : <TeacherHome />
  if (module === 'campus') return <OrganizationCampusPage />
  if (module === 'management' && !student) return <CampusManagementPage />
  if (module === 'teams') return student ? <StudentTeamPage /> : <TeamPage />
  if (module === 'homeworks') return student ? <StudentHomeworkPage /> : <TeacherHomeworkPage />
  if (module === 'contests') return student ? <StudentContestsPage /> : <TeacherContestsPage />
  if (module === 'training-sessions') return <TrainingSessionListPage organizationId={organizationId} />
  if (module === 'problems' && !student) return <TeacherProblemsPage />
  if (module === 'problem-lists') return student ? <StudentProblemListsPage /> : <TeacherProblemListsPage />
  if (module === 'rankings') return student ? <StudentRankingsPage /> : <TeacherRankingsPage />
  if (module === 'submissions') return <SubmissionList viewRole={student ? 'student' : 'teacher'} />
  return student ? <StudentHome /> : <TeacherHome />
}
