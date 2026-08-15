'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, type WorkspaceSummary } from '@/components/AuthProvider'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import { apiClient } from '@/lib/apiClient'

export default function TeacherWalletRedirectPage() {
  const { user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    void apiClient.get<{ workspaces: WorkspaceSummary[] }>('/api/workspaces').then(result => {
      const workspace = result.data?.workspaces.find(item => item.type === 'organization' && item.schoolId === user?.schoolId)
        || result.data?.workspaces.find(item => item.type === 'organization')
      router.replace(workspace?.organizationId ? '/org/' + workspace.organizationId + '/wallet' : '/teacher/school')
    })
  }, [router, user?.schoolId])

  return <PageLoadingFrame title="组织钱包" />
}
