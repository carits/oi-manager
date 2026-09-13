'use client'

import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

const SubmissionDetailPage = dynamic(
  () => import('@/features/submission').then(module => module.SubmissionDetailPage),
  { loading: () => <PageLoadingFrame title="评测详情" rows={8} /> },
)

export default function PersonalSubmissionDetailPage() {
  return <SubmissionDetailPage role="student" submissionId={useParams().id as string} />
}
