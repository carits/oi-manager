'use client'

import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

const ProblemDetail = dynamic(
  () => import('@/components/problem/ProblemDetail').then(module => module.ProblemDetail),
  { loading: () => <PageLoadingFrame title="题目详情" rows={8} /> },
)

export default function ProblemDetailPage() {
  const params = useParams()
  const problemId = params.id as string

  return (
    <>
      <ProblemDetail role="teacher" problemId={problemId} />
    </>
  )
}
