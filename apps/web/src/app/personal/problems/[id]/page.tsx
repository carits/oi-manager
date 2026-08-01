'use client'

import dynamic from 'next/dynamic'
import { useParams } from 'next/navigation'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

const ProblemDetail = dynamic(
  () => import('@/components/problem/ProblemDetail').then(module => module.ProblemDetail),
  { loading: () => <PageLoadingFrame title="题目详情" rows={8} /> },
)

export default function PersonalProblemDetailPage() {
  const problemId = useParams().id as string
  return <ProblemDetail role="student" problemId={problemId} />
}
