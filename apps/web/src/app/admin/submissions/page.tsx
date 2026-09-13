'use client'

import dynamic from 'next/dynamic'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

const SubmissionList = dynamic(
  () => import('@/features/submission').then(module => module.SubmissionList),
  { loading: () => <PageLoadingFrame title="评测记录" rows={8} /> },
)

export default function AdminSubmissionsPage() {
  return <SubmissionList viewRole="admin" />
}
