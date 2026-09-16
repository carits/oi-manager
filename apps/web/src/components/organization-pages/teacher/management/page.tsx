'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, usePathname, useSearchParams } from 'next/navigation'
import { useAuth } from '@/features/auth'
import { listWorkspaces } from '@/features/workspace'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Empty } from '@/components/ui/Empty'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import StudentsManagementContent from '@/components/management/StudentsManagementContent'
import TeachersManagementContent from '@/components/management/TeachersManagementContent'
import { WalletPage } from '@/features/account-wallet'
import { apiClient } from '@/lib/apiClient'
import { JoinApplicationsManagement, OrganizationInvitationsManagement, OrganizationJoinSettings } from '@/features/organization-account'
import styles from '@/features/ranking/RankingPage.module.css'

type Tab = 'students' | 'teachers' | 'applications' | 'invitations' | 'settings' | 'wallet'

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
  const resolvedTab: Tab = requestedTab === 'teachers' && isPrincipal ? 'teachers' : requestedTab === 'settings' && isPrincipal ? 'settings' : requestedTab === 'applications' || requestedTab === 'invitations' || requestedTab === 'wallet' ? requestedTab : 'students'
  const [activeTab, setActiveTab] = useState<Tab>(resolvedTab)
  const [pending, setPending] = useState({ applications: 0, invitations: 0 })

  useEffect(() => {
    if (params.organizationId) return
    void listWorkspaces().then(result => {
      const workspace = result.workspaces.find(item => item.type === 'organization')
      setOrganizationId(workspace?.organizationId || '')
      setLoadingWorkspace(false)
    }).catch(() => setLoadingWorkspace(false))
  }, [params.organizationId])

  const items = useMemo(() => [
    { value: 'students', label: '学生' },
    ...(isPrincipal ? [{ value: 'teachers', label: '教师' }] : []),
    { value: 'applications', label: `加入申请${pending.applications ? ` ${pending.applications}` : ''}` },
    { value: 'invitations', label: `成员邀请${pending.invitations ? ` ${pending.invitations}` : ''}` },
    ...(isPrincipal ? [{ value: 'settings', label: '加入设置' }] : []),
    { value: 'wallet', label: '学校资产' },
  ], [isPrincipal, pending])

  useEffect(() => {
    if (!organizationId) return
    void Promise.all([
      apiClient.get<{ pending: number }>(`/api/organizations/${organizationId}/join-applications?pageSize=1`),
      apiClient.get<{ pending: number }>(`/api/organizations/${organizationId}/invitations?pageSize=1`),
    ]).then(([applications, invitations]) => setPending({ applications: applications.data?.pending || 0, invitations: invitations.data?.pending || 0 }))
  }, [organizationId, activeTab])

  useEffect(() => { setActiveTab(resolvedTab) }, [resolvedTab])

  const setTab = (tab: string) => {
    const nextTab = tab as Tab
    setActiveTab(nextTab)
    const next = new URLSearchParams(searchParams.toString())
    nextTab === 'students' ? next.delete('tab') : next.set('tab', nextTab)
    window.history.replaceState(null, '', pathname + (next.size ? '?' + next : ''))
  }

  if (role === 'student') return <Empty title="无权访问管理" description="学生不能访问学校管理内容。" />
  if (loadingWorkspace) return <PageLoadingFrame title="管理" />

  return (
    <PageFrame>
      <div className={styles.content}>
        <PageHeader title="成员与学校管理" description="管理本校学生、教师、加入方式与学校资产。" />
        <SegmentedControl label="管理内容" value={activeTab} onChange={setTab} items={items} />
        {activeTab === 'students' && <StudentsManagementContent />}
        {activeTab === 'teachers' && isPrincipal && <TeachersManagementContent />}
        {activeTab === 'applications' && organizationId && <JoinApplicationsManagement organizationId={organizationId} isPrincipal={isPrincipal} initialApplicationId={searchParams.get('applicationId')} onOpenSettings={() => setTab('settings')} />}
        {activeTab === 'invitations' && organizationId && <OrganizationInvitationsManagement organizationId={organizationId} isPrincipal={isPrincipal} />}
        {activeTab === 'settings' && organizationId && isPrincipal && <OrganizationJoinSettings organizationId={organizationId} />}
        {activeTab === 'wallet' && organizationId && <WalletPage embedded scope="organization" organizationId={organizationId} />}
        {activeTab === 'wallet' && !organizationId && <Empty title="未找到学校" description="当前账号没有可访问的学校资产。" />}
      </div>
    </PageFrame>
  )
}
