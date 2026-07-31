'use client'

import { useParams } from 'next/navigation'
import { ProblemNote } from '@/components/problem/ProblemNote'

export default function ProblemNotePage() {
  const params = useParams()
  const problemId = params.id as string

  return (
    <>
      <ProblemNote role="admin" problemId={problemId} />
    </>
  )
}