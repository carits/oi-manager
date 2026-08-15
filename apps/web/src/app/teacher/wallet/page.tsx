'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

export default function TeacherWalletRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/teacher/management?tab=wallet')
  }, [router])

  return <PageLoadingFrame title="组织钱包" />
}
