'use client'

import { useParams } from 'next/navigation'
import { ProblemNote } from '@/features/problem/ProblemNote'

export default function PersonalProblemNotePage() {
  const problemId = useParams<{ id: string }>().id

  return <ProblemNote role="student" problemId={problemId} />
}
