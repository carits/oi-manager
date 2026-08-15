'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

export default function TeachersPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/teacher/management?tab=teachers') }, [router])
  return <PageLoadingFrame title="管理" />
}
