'use client'

import { ProblemForm } from '@/components/problem/ProblemForm'

export default function NewProblemPage() {
  return (
    <>
      <ProblemForm mode="create" role="teacher" />
    </>
  )
}
