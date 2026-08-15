'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, usePathname, useSearchParams } from 'next/navigation'
import { useAuth, type WorkspaceSummary } from '@/components/AuthProvider'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Empty } from '@/components/ui/Empty'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import StudentsManagementContent from '@/components/management/StudentsManagementContent'
import TeachersManagementContent from '@/components/management/TeachersManagementContent'
import { WalletPage } from '@/components/wallet/WalletPage'
import { apiClient } from '@/lib/apiClient'
import styles from '@/components/ranking/RankingPage.module.css'

type Tab = 'students' | 'teachers' | 'wallet'

export default function CampusManagementPage() {
  const { user } = useAuth()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = useParams<{ organizationId?: string }>()
  const [organizationId, setOrganizationId] = useState(params.organizationId || '')
  const [loadingWorkspace, setLoadingWorkspace] = useState(!params.organizationId)
  const role = user?.organizationRole || user?.role
  const isPrincipal = role === 'school_principal'
  const requestedTab = searchParams.get('tab')
  const resolvedTab: Tab = requestedTab === 'teachers' && isPrincipal ? 'teachers' : requestedTab === 'wallet' ? 'wallet' : 'students'
  const [activeTab, setActiveTab] = useState<Tab>(resolvedTab)

  useEffect(() => {
    if (params.organizationId) return
    void apiClient.get<{ workspaces: WorkspaceSummary[] }>('/api/workspaces').then(result => {
      const workspace = result.data?.workspaces.find(item => item.type === 'organization' && item.schoolId === user?.schoolId)
        || result.data?.workspaces.find(item => item.type === 'organization')
      setOrganizationId(workspace?.organizationId || '')
      setLoadingWorkspace(false)
    })
  }, [params.organizationId, user?.schoolId])

  const items = useMemo(() => [
    { value: 'students', label: '学生' },
    ...(isPrincipal ? [{ value: 'teachers', label: '教师' }] : []),
    { value: 'wallet', label: '校园资产' },
  ], [isPrincipal])

  useEffect(() => { setActiveTab(resolvedTab) }, [resolvedTab])

  const setTab = (tab: string) => {
    const nextTab = tab as Tab
    setActiveTab(nextTab)
    const next = new URLSearchParams(searchParams.toString())
    nextTab === 'students' ? next.delete('tab') : next.set('tab', nextTab)
    window.history.replaceState(null, '', pathname + (next.size ? '?' + next : ''))
  }

  if (role === 'student') return <Empty title="无权访问管理" description="学生不能访问校园管理内容。" />
  if (loadingWorkspace) return <PageLoadingFrame title="管理" />

  return (
    <PageFrame>
      <div className={styles.content}>
        <PageHeader title="管理" description="管理本校园的学生、教师与资产。" />
        <SegmentedControl label="管理内容" value={activeTab} onChange={setTab} items={items} />
        {activeTab === 'students' && <StudentsManagementContent />}
        {activeTab === 'teachers' && isPrincipal && <TeachersManagementContent />}
        {activeTab === 'wallet' && organizationId && <WalletPage scope="organization" endpoint={'/api/carits/organizations/' + organizationId + '/transactions'} />}
        {activeTab === 'wallet' && !organizationId && <Empty title="未找到校园" description="当前账号没有可访问的校园资产。" />}
      </div>
    </PageFrame>
  )
}
