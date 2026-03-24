'use client'

import { useParams } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ProblemDetail } from '@/components/problem/ProblemDetail'

export default function ProblemDetailPage() {
  const params = useParams()
  const problemId = params.id as string

  return (
    <ProtectedRoute requiredRole="teacher">
      <ProblemDetail role="teacher" problemId={problemId} />
    </ProtectedRoute>
  )
}