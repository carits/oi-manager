'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useEffect, useState } from 'react'
import { useParams, usePathname, useSearchParams } from 'next/navigation'
import { useAuth } from '@/features/auth'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Tabs } from '@/components/ui/Tabs'
import { LoadError } from '@/components/ui/LoadError'
import { ContextualRecovery } from '@/components/navigation/ContextualRecovery'
import { useNavigationGuard } from '@/components/navigation/UnsavedChangesProvider'
import StudentsManagementContent from '@/components/management/StudentsManagementContent'
import TeachersManagementContent from '@/components/management/TeachersManagementContent'
import { WalletPage } from '@/features/account-wallet'
import { getOrganizationInvitations, getOrganizationJoinApplications, JoinApplicationsManagement, OrganizationInvitationsManagement, OrganizationJoinSettings } from '@/features/organization-account'
import styles from './SchoolManagement.module.css'

type Tab = 'students' | 'teachers' | 'applications' | 'invitations' | 'settings' | 'wallet'
const validTabs = new Set<string>(['students', 'teachers', 'applications', 'invitations', 'settings', 'wallet'])

export default function CampusManagementPage() {
  const { user } = useAuth()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { organizationId = '' } = useParams<{ organizationId?: string }>()
  const { requestNavigation } = useNavigationGuard()
  const isPrincipal = user?.organizationRole === 'school_principal'
  const role = user?.organizationRole
  const requestedTab = searchParams.get('tab') || 'students'
  const activeTab = requestedTab as Tab
  const deniedTab = (activeTab === 'teachers' || activeTab === 'settings') && !isPrincipal
  const [pending, setPending] = useState({ applications: 0, invitations: 0 })
  const [countError, setCountError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    if (!organizationId || !role || role === 'student' || activeTab === 'students' || deniedTab || !validTabs.has(activeTab)) return
    let current = true
    void Promise.allSettled([getOrganizationJoinApplications(organizationId), getOrganizationInvitations(organizationId)])
      .then(([applications, invitations]) => {
        if (!current) return
        setPending(previous => ({ applications: applications.status === 'fulfilled' ? applications.value.pending : previous.applications, invitations: invitations.status === 'fulfilled' ? invitations.value.pending : previous.invitations }))
        const failure = [applications, invitations].find(result => result.status === 'rejected')
        setCountError(failure?.status === 'rejected' ? (publicErrorMessage(failure.reason, '待处理数量更新失败')) : '')
      })
    return () => { current = false }
  }, [activeTab, deniedTab, organizationId, refreshVersion, role])

  const setTab = (tab: string) => {
    if (!validTabs.has(tab) || tab === activeTab) return
    const next = new URLSearchParams(searchParams.toString())
    next.set('tab', tab)
    next.delete('applicationId')
    requestNavigation(`${pathname}?${next.toString()}`)
  }

  if (!organizationId) return <ContextualRecovery status="error" title="缺少学校上下文" description="请从学校工作区进入管理页面。" />
  if (role === 'student' || deniedTab) return <ContextualRecovery status="403" title="无权访问该管理内容" description="当前学校成员身份不能访问此内容。" />
  if (!validTabs.has(requestedTab)) return <ContextualRecovery status="404" title="没有这个管理分区" description="请使用左侧学生或学校管理入口。" />

  // The student component owns its heading and actions; do not duplicate them here.
  if (activeTab === 'students') return <PageFrame><StudentsManagementContent /></PageFrame>

  const items = [
    ...(isPrincipal ? [{ value: 'teachers', label: '教师与权限' }] : []),
    { value: 'applications', label: '加入申请', count: pending.applications },
    { value: 'invitations', label: '成员邀请', count: pending.invitations },
    ...(isPrincipal ? [{ value: 'settings', label: '加入设置' }] : []),
    { value: 'wallet', label: '学校资产' },
  ]
  return <PageFrame>
    <PageHeader title="学校管理" description="管理教师、加入方式和学校资产；学生管理保留在左侧独立入口。" />
    <Tabs label="学校管理分区" value={activeTab} onChange={setTab} items={items} />
    {countError && <LoadError compact message={`待处理数量可能不是最新：${countError}`} onRetry={() => setRefreshVersion(value => value + 1)} />}
    <div className={styles.content}>
      {activeTab === 'teachers' && isPrincipal && <TeachersManagementContent />}
      {activeTab === 'applications' && <JoinApplicationsManagement organizationId={organizationId} isPrincipal={isPrincipal} initialApplicationId={searchParams.get('applicationId')} onOpenSettings={() => setTab('settings')} />}
      {activeTab === 'invitations' && <OrganizationInvitationsManagement organizationId={organizationId} isPrincipal={isPrincipal} />}
      {activeTab === 'settings' && isPrincipal && <OrganizationJoinSettings organizationId={organizationId} />}
      {activeTab === 'wallet' && <WalletPage embedded scope="organization" organizationId={organizationId} />}
    </div>
  </PageFrame>
}
