'use client'

import { useEffect } from 'react'
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
import { TrainingSessionListPage } from '@/features/training-session/TrainingSessionListPage'
import { SubmissionList } from '@/features/submission'
import { useAuth } from '@/features/auth'
import { BlogDiscovery } from '@/features/blog'
import { ContextualRecovery } from '@/components/navigation/ContextualRecovery'

const studentModules = new Set(['overview', 'campus', 'teams', 'homeworks', 'contests', 'training-sessions', 'problem-lists', 'rankings', 'submissions', 'knowledge'])
const knownModules = new Set([...studentModules, 'management', 'problems'])
const legacyModules = new Set(['carits', 'contributions', 'students', 'teachers', 'wallet'])

export default function OrgPage() {
  const { module, organizationId } = useParams<{ module: string; organizationId: string }>()
  const router = useRouter()
  const { user, status } = useAuth()
  const contextMatches = user?.organizationId === organizationId && Boolean(user.organizationRole)
  const workspaceRole = contextMatches ? user.organizationRole : null
  const student = workspaceRole === 'student'
  const studentModuleAllowed = !student || studentModules.has(module)

  useEffect(() => {
    const legacyTarget: Record<string, string> = {
      carits: '/org/' + organizationId + '/management?tab=wallet',
      contributions: '/org/' + organizationId + '/rankings?tab=contribution',
      students: '/org/' + organizationId + '/management?tab=students',
      teachers: '/org/' + organizationId + '/management?tab=teachers',
      wallet: '/org/' + organizationId + '/management?tab=wallet',
    }
    if (legacyTarget[module]) router.replace(legacyTarget[module])
  }, [module, organizationId, router])

  if (legacyModules.has(module)) return null
  if (status === 'degraded') return <ContextualRecovery status="error" title="校园工作区暂时无法加载" description="校园身份服务暂时不可用，请刷新后重试。" />
  if (!contextMatches) return <ContextualRecovery status="403" title="无法打开这所学校" description="当前账号没有该校园的有效成员关系。" />
  if (!knownModules.has(module)) return <ContextualRecovery status="404" title="这里没有这个学校页面" description="链接可能已经失效，或功能位置发生了变化。" />
  if (!studentModuleAllowed) return <ContextualRecovery status="403" title="无法访问该页面" description="你当前以学生身份进入这所学校，此功能仅教师或学校负责人可以使用。" />
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
  if (module === 'knowledge') return <BlogDiscovery workspaceBasePath={`/org/${organizationId}/knowledge`} embedded />
  return <ContextualRecovery status="404" title="这里没有这个学校页面" description="链接可能已经失效，或功能位置发生了变化。" />
}
