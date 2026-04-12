'use client'

import { useParams } from 'next/navigation'
import { SubmissionDetailPage } from '@/components/submission/SubmissionDetailPage'

export default function TeacherSubmissionDetailPage() {
  const params = useParams()
  const submissionId = params.id as string

  return <SubmissionDetailPage role="teacher" submissionId={submissionId} />
}
