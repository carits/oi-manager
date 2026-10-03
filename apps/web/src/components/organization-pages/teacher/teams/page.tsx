'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useState, useEffect } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { createTeam, listMyTeamInvitations, respondToTeamInvitation, TeamListPage, TeamItem, Invitation } from '@/features/team'
import { useTeams, Team } from '@/features/team'
import { useAuth } from '@/features/auth'
import { useToast } from '@/components/ui/Toast'
import { currentWorkspacePrefix } from '@/lib/workspacePath'

export default function TeamsPage() {
  const { user, sessionKey } = useAuth()
  const toast = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const pathPrefix = currentWorkspacePrefix(pathname, '/personal/teams', '/teams')
  // 分页状态
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [activeTab, setActiveTab] = useState<'mine' | 'all'>(
    (searchParams.get('tab') as 'mine' | 'all') || 'mine'
  )

  useEffect(() => {
    const tab = searchParams.get('tab') as 'mine' | 'all'
    if (tab === 'mine' || tab === 'all') setActiveTab(tab)
  }, [searchParams])

  // 构建查询参数 - 后端会从 JWT token 中获取 teacherId
  const queryParams = {
    page,
    pageSize,
    view: activeTab === 'mine' ? 'mine' : 'all'
  } as const

  const { data, loading, error, refetch } = useTeams(queryParams, sessionKey)

  // 邀请相关状态
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loadingInvitations, setLoadingInvitations] = useState(true)
  const [processingInvitation, setProcessingInvitation] = useState<string | null>(null)

  // 创建团队弹窗
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  // 转换 Team 数据格式
  const teams: TeamItem[] = (data?.data || []).map((team: Team) => ({
    id: team.id,
    name: team.name,
    avatar: team.avatar,
    description: team.description,
    isPublic: team.isPublic,
    school: team.school,
    owner: team.owner,
    _count: team._count
  }))

  // 获取邀请列表
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoadingInvitations(true)
        const [adminResult, memberResult] = await Promise.all([
          listMyTeamInvitations('admin'),
          listMyTeamInvitations('member')
        ])
        const adminInvitations = adminResult.map(invitation => ({ ...invitation, type: 'admin' as const }))
        const memberInvitations = memberResult.map(invitation => ({ ...invitation, type: 'member' as const }))
        setInvitations([...adminInvitations, ...memberInvitations])
      } catch (error) {
        console.error('Failed to fetch invitations:', error)
        toast.error(publicErrorMessage(error, '团队邀请加载失败'))
      } finally {
        setLoadingInvitations(false)
      }
    }
    if (user?.organizationRole === 'teacher' || user?.organizationRole === 'school_principal') fetchData()
  }, [toast, user?.organizationRole])

  // 接受邀请
  const handleAcceptInvitation = async (invitationId: string, type: 'admin' | 'member') => {
    try {
      setProcessingInvitation(invitationId)
      const result = await respondToTeamInvitation(invitationId, 'accept', type)
      if (result.ok) {
        setInvitations(invitations.filter(i => i.id !== invitationId))
        refetch()
      } else {
        toast.error(result.error.userMessage || '操作失败')
      }
    } catch (error) {
      toast.error('操作失败')
    } finally {
      setProcessingInvitation(null)
    }
  }

  // 拒绝邀请
  const handleRejectInvitation = async (invitationId: string, type: 'admin' | 'member') => {
    try {
      setProcessingInvitation(invitationId)
      const result = await respondToTeamInvitation(invitationId, 'reject', type)
      if (result.ok) {
        setInvitations(invitations.filter(i => i.id !== invitationId))
      } else {
        toast.error(result.error.userMessage || '操作失败')
      }
    } catch (error) {
      toast.error('操作失败')
    } finally {
      setProcessingInvitation(null)
    }
  }

  // 创建团队
  const handleCreateTeam = async (data: { name: string; description: string; isPublic: boolean; teamId: string }) => {
    try {
      setCreating(true)
      const result = await createTeam({
        name: data.name,
        description: data.description,
        isPublic: data.isPublic,
        id: data.teamId
      })
      if (result.ok) {
        setCreateModalOpen(false)
        refetch()
        toast.success('团队创建成功')
        return true
      } else {
        toast.error(result.error.userMessage || '创建失败')
        return false
      }
    } catch (error) {
      toast.error('创建失败')
      return false
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <TeamListPage
        basePath={pathPrefix}
        teams={teams}
        loading={loading}
        error={error}
        onRetry={refetch}
        page={page}
        pageSize={pageSize}
        total={data?.total || 0}
        totalPages={data?.totalPages || 1}
        onPageChange={setPage}
        onPageSizeChange={(newSize) => { setPageSize(newSize); setPage(1) }}
        activeTab={activeTab}
        onTabChange={(tab) => { setActiveTab(tab); setPage(1); router.push(pathPrefix + '?tab=' + tab, { scroll: false }) }}
        invitations={invitations}
        loadingInvitations={loadingInvitations}
        processingInvitation={processingInvitation}
        onAcceptInvitation={handleAcceptInvitation}
        onRejectInvitation={handleRejectInvitation}
        onCreateTeam={handleCreateTeam}
        createModalOpen={createModalOpen}
        onOpenCreateModal={() => setCreateModalOpen(true)}
        onCloseCreateModal={() => setCreateModalOpen(false)}
        creating={creating}
      />
    </>
  )
}
