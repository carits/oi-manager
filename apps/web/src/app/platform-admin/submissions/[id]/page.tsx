'use client'

import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

const SubmissionDetailPage = dynamic(
  () => import('@/features/submission').then(module => module.SubmissionDetailPage),
  { loading: () => <PageLoadingFrame title="评测详情" rows={8} /> },
)

export default function PlatformAdminSubmissionDetailPage() {
  const params = useParams()
  const submissionId = params.id as string

  return <SubmissionDetailPage role="admin" submissionId={submissionId} />
}
