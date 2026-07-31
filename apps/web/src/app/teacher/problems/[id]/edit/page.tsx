'use client'

import { useParams } from 'next/navigation'
import { ProblemForm } from '@/components/problem/ProblemForm'

export default function EditProblemPage() {
  const params = useParams()
  const problemId = params.id as string

  return (
    <>
      <ProblemForm mode="edit" role="teacher" problemId={problemId} />
    </>
  )
}