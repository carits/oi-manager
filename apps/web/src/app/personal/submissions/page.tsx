'use client'

import dynamic from 'next/dynamic'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

const SubmissionList = dynamic(
  () => import('@/components/submission/SubmissionList').then(module => module.SubmissionList),
  { loading: () => <PageLoadingFrame title="评测记录" rows={8} /> },
)

export default function PersonalSubmissionsPage() {
  return <SubmissionList viewRole="student" />
}
