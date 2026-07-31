'use client'

import { useParams } from 'next/navigation'
import { ProblemNote } from '@/components/problem/ProblemNote'

export default function TeacherProblemNotePage() {
  const params = useParams()
  const problemId = params.id as string

  return (
    <>
      <ProblemNote role="teacher" problemId={problemId} />
    </>
  )
}