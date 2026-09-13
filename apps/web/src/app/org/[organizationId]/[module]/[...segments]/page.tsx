'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { TeamDetailPage } from '@/components/team/TeamDetailPage'
import { TrainingDetailPage } from '@/components/training/TrainingDetailPage'
import { ProblemDetail } from '@/components/problem/ProblemDetail'
import { ProblemForm } from '@/components/problem/ProblemForm'
import { ProblemNote } from '@/components/problem/ProblemNote'
import { SubmissionDetailPage } from '@/features/submission'
import ProblemListDetailPage from '@/components/problem/ProblemListDetailPage'
import { TrainingStatementManagementPage } from '@/components/training/TrainingStatementManagementPage'
import { TrainingSessionWorkspace } from '@/components/training-engine/TrainingSessionWorkspace'
import { TrainingSessionDesigner } from '@/components/training-engine/TrainingSessionDesigner'
import { AssignmentWorkspace } from '@/features/assignment'
import { BlogDiscoveryDetail } from '@/features/blog'
import { ContextualRecovery } from '@/components/navigation/ContextualRecovery'

export default function OrganizationResourcePage() {
  const { organizationId, module, segments } = useParams<{ organizationId: string; module: string; segments: string[] }>()
  const { user } = useAuth()
  const router = useRouter()
  const parts = segments || []
  const prefix = `/org/${organizationId}`
  const userType = user?.organizationRole === 'student' ? 'student' : 'teacher'
  const legacyTeamContestId = module === 'teams' && parts.length >= 3 && parts[1] === 'contests' ? parts[2] : null
  useEffect(() => {
    if (legacyTeamContestId) router.replace(`${prefix}/contests/${legacyTeamContestId}${parts[3] === 'statements' ? '/statements' : ''}`)
  }, [legacyTeamContestId, parts[3], prefix, router])

  if (legacyTeamContestId) return <ContextualRecovery title="正在打开比赛" description="比赛详情已统一到学校比赛页面。" />

  if (module === 'teams' && parts.length === 1) {
    return <TeamDetailPage userType={userType} basePath={`${prefix}/teams`} requiredRole={['teacher', 'school_principal', 'student']} teamIdOverride={parts[0]} />
  }
  if (module === 'teams' && parts.length === 3 && ['trainings', 'homeworks'].includes(parts[1])) {
    return <TrainingDetailPage basePath={`${prefix}/teams`} trainingIdOverride={parts[2]} />
  }
  if (module === 'teams' && parts.length === 4 && ['trainings', 'homeworks'].includes(parts[1]) && parts[3] === 'statements') {
    return <TrainingStatementManagementPage trainingId={parts[2]} backPath={`${prefix}/teams/${parts[0]}/${parts[1]}/${parts[2]}`} />
  }
  if ((module === 'contests' || module === 'homeworks') && parts.length === 2 && parts[1] === 'statements') {
    return <TrainingStatementManagementPage trainingId={parts[0]} backPath={`${prefix}/${module}/${parts[0]}`} />
  }
  if (module === 'homeworks' && parts.length === 1) {
    return <AssignmentWorkspace />
  }
  if (module === 'contests' && parts.length === 1) {
    return <TrainingDetailPage basePath={prefix} trainingIdOverride={parts[0]} />
  }
  if (module === 'training-sessions' && parts.length === 1) return <TrainingSessionWorkspace sessionId={parts[0]} />
  if (module === 'training-sessions' && parts.length === 2 && parts[1] === 'design') return <TrainingSessionDesigner sessionId={parts[0]} />
  if (module === 'problems' && parts.length === 1 && parts[0] === 'new') {
    return <ProblemForm mode="create" role={userType} />
  }
  if (module === 'problems' && parts.length === 2 && parts[1] === 'edit') {
    return <ProblemForm mode="edit" role={userType} problemId={parts[0]} />
  }
  if (module === 'problems' && parts.length === 2 && parts[1] === 'note') {
    return <ProblemNote role={userType} problemId={parts[0]} />
  }
  if (module === 'problems' && parts.length === 1) return <ProblemDetail role={userType} problemId={parts[0]} />
  if (module === 'submissions' && parts.length === 1) return <SubmissionDetailPage role={userType} submissionId={parts[0]} />
  if (module === 'problem-lists' && parts.length === 1) return <ProblemListDetailPage listIdOverride={parts[0]} />
  if (module === 'knowledge' && parts.length === 1) return <BlogDiscoveryDetail id={parts[0]} workspaceBasePath={`${prefix}/knowledge`} embedded />
  return <ContextualRecovery status="404" title="这里没有这个学校页面" description="链接可能已经失效，或功能位置发生了变化。" />
}
