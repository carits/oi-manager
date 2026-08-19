'use client'

import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

const SubmissionDetailPage = dynamic(
  () => import('@/components/submission/SubmissionDetailPage').then(module => module.SubmissionDetailPage),
  { loading: () => <PageLoadingFrame title="评测详情" rows={8} /> },
)

export default function AdminSubmissionDetailPage() {
  const params = useParams()
  return <SubmissionDetailPage role="admin" submissionId={params.id as string} />
}
