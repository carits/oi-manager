'use client'

import { useParams } from 'next/navigation'
import { ProblemForm } from '@/features/problem/ProblemForm'

export default function EditProblemPage() {
  const params = useParams()
  const problemId = params.id as string

  return (
    <>
      <ProblemForm mode="edit" role="admin" problemId={problemId} />
    </>
  )
}
