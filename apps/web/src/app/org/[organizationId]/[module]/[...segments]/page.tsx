'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { TeamDetailPage } from '@/components/team/TeamDetailPage'
import { TrainingDetailPage } from '@/components/training/TrainingDetailPage'
import { ProblemDetail } from '@/components/problem/ProblemDetail'
import { ProblemForm } from '@/components/problem/ProblemForm'
import { ProblemNote } from '@/components/problem/ProblemNote'
import { SubmissionDetailPage } from '@/components/submission/SubmissionDetailPage'
import ProblemListDetailPage from '@/components/problem/ProblemListDetailPage'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import { TrainingStatementManagementPage } from '@/components/training/TrainingStatementManagementPage'

export default function OrganizationResourcePage() {
  const { organizationId, module, segments } = useParams<{ organizationId: string; module: string; segments: string[] }>()
  const router = useRouter()
  const { user } = useAuth()
  const parts = segments || []
  const prefix = `/org/${organizationId}`
  const userType = user?.organizationRole === 'student' ? 'student' : 'teacher'

  useEffect(() => {
    const supported =
      (module === 'teams' && (parts.length === 1 || ((parts.length === 3 || parts.length === 4) && ['contests', 'trainings', 'homeworks'].includes(parts[1])))) ||
      ((module === 'contests' || module === 'homeworks') && (parts.length === 1 || (parts.length === 2 && parts[1] === 'statements'))) ||
      (module === 'problems' && (
        parts.length === 1 ||
        (parts.length === 2 && ['edit', 'note'].includes(parts[1]))
      )) ||
      ((module === 'submissions' || module === 'problem-lists') && parts.length === 1)
    if (!supported) router.replace(`${prefix}/${module}`)
  }, [module, parts, prefix, router])

  if (module === 'teams' && parts.length === 1) {
    return <TeamDetailPage userType={userType} basePath={`${prefix}/teams`} requiredRole={['teacher', 'school_principal', 'student']} teamIdOverride={parts[0]} />
  }
  if (module === 'teams' && parts.length === 3 && ['contests', 'trainings', 'homeworks'].includes(parts[1])) {
    return <TrainingDetailPage basePath={`${prefix}/teams`} trainingIdOverride={parts[2]} />
  }
  if (module === 'teams' && parts.length === 4 && ['contests', 'trainings', 'homeworks'].includes(parts[1]) && parts[3] === 'statements') {
    return <TrainingStatementManagementPage trainingId={parts[2]} />
  }
  if ((module === 'contests' || module === 'homeworks') && parts.length === 2 && parts[1] === 'statements') {
    return <TrainingStatementManagementPage trainingId={parts[0]} />
  }
  if ((module === 'contests' || module === 'homeworks') && parts.length === 1) {
    return <TrainingDetailPage basePath={prefix} trainingIdOverride={parts[0]} />
  }
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
  return <PageLoadingFrame title="正在返回组织页面" rows={4} />
}
