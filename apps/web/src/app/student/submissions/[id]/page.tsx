'use client'

import { useParams } from 'next/navigation'
import { SubmissionDetailPage } from '@/components/submission/SubmissionDetailPage'

export default function StudentSubmissionDetailPage() {
  const params = useParams()
  const submissionId = params.id as string

  return <SubmissionDetailPage role="student" submissionId={submissionId} />
}
