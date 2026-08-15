'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

export default function StudentsPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/teacher/management?tab=students') }, [router])
  return <PageLoadingFrame title="管理" />
}
