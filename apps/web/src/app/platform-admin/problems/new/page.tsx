'use client'

import { ProblemForm } from '@/features/problem/ProblemForm'

export default function NewProblemPage() {
  return (
    <>
      <ProblemForm mode="create" role="admin" />
    </>
  )
}
