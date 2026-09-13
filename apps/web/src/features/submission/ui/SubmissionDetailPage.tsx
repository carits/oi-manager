'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import {
  SubmissionDetailContent,
  SubmissionDetailErrorState,
  submissionDetailTitle,
} from './SubmissionDetailContent'
import { useSubmissionDetail } from '../model/useSubmissionDetail'

interface SubmissionDetailPageProps {
  role: 'teacher' | 'student' | 'admin'
  submissionId: string
}
export function SubmissionDetailPage({ submissionId }: SubmissionDetailPageProps) {
  const pathname = usePathname()
  const router = useRouter()
  const numericId = /^\d+$/.test(submissionId) ? Number(submissionId) : null
  const { detail, loading, error, retry } = useSubmissionDetail({ submissionId: numericId })
  const workspacePrefix = pathname.startsWith('/personal/') ? '/personal' : currentWorkspacePrefix(pathname, '/personal')
  const listPath = `${workspacePrefix}/submissions`
  const breadcrumbs = [{ label: '评测记录', href: listPath }, { label: detail ? `#${detail.id}` : '详情' }]

  return (
    <PageFrame width="workbench">
      <PageHeader
        title={detail ? submissionDetailTitle(detail) : '提交详情'}
        breadcrumbs={breadcrumbs}
        actions={<Button variant="secondary" onClick={() => router.push(listPath)}>返回评测记录</Button>}
      />
      {loading && !detail ? (
        <SkeletonRegion rows={8} label="评测详情正在准备" />
      ) : error && !detail ? (
        <SubmissionDetailErrorState error={error} onRetry={retry} onBack={() => router.push(listPath)} />
      ) : detail ? (
        <SubmissionDetailContent detail={detail} />
      ) : null}
    </PageFrame>
  )
}
