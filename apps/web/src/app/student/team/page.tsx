'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { TeamListPage, TeamItem, Invitation } from '@/components/team'
import { useTeams, Team } from '@/hooks/data/useTeams'
import { useAuth } from '@/components/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'

// 学生端 - 团队管理页面
export default function StudentTeamPage() {
  const { user, sessionKey } = useAuth()
  const toast = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()

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

  // 构建查询参数 - 后端会从 JWT token 中获取 studentId
  const queryParams = {
    page,
    pageSize,
    schoolId: user?.studentMode === 'campus' ? user?.schoolId : undefined,
    view: activeTab === 'mine' ? 'mine' : 'all'
  }

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

  // 获取邀请列表 - 后端会从 JWT token 中获取 studentId
  useEffect(() => {
    const fetchInvitations = async () => {
      if (!user?.userId) return
      try {
        setLoadingInvitations(true)
        const data = await apiClient.get<any>(`/api/teams/student/${user.userId}`)
        if (data.success) {
          const pending = (data.data?.pending || []).map((inv: any) => ({
            id: inv.invitationId,
            teamId: inv.id,
            teamName: inv.name,
            schoolName: inv.school?.name || '',
            memberCount: inv._count?.members || 0,
            ownerName: inv.owner?.name,
            invitedAt: inv.invitedAt,
            type: 'member' as const
          }))
          setInvitations(pending)
        }
      } catch (error) {
        console.error('Failed to fetch invitations:', error)
      } finally {
        setLoadingInvitations(false)
      }
    }
    fetchInvitations()
  }, [sessionKey, user?.userId])

  // 接受邀请
  const handleAcceptInvitation = async (invitationId: string) => {
    try {
      setProcessingInvitation(invitationId)
      const result = await apiClient.post(`/api/teams/invitations/${invitationId}/accept`)
      if (result.success) {
        setInvitations(invitations.filter(i => i.id !== invitationId))
        refetch()
      } else {
        toast.error(result.message || '操作失败')
      }
    } catch (error) {
      toast.error('操作失败')
    } finally {
      setProcessingInvitation(null)
    }
  }

  // 拒绝邀请
  const handleRejectInvitation = async (invitationId: string) => {
    try {
      setProcessingInvitation(invitationId)
      const result = await apiClient.post(`/api/teams/invitations/${invitationId}/reject`)
      if (result.success) {
        setInvitations(invitations.filter(i => i.id !== invitationId))
      } else {
        toast.error(result.message || '操作失败')
      }
    } catch (error) {
      toast.error('操作失败')
    } finally {
      setProcessingInvitation(null)
    }
  }

  // 创建团队
  const handleCreateTeam = async (formData: { name: string; description: string; isPublic: boolean; teamId: string }) => {
    if (!formData.name.trim()) {
      toast.warning('请输入团队名称')
      return false
    }

    try {
      setCreating(true)
      const result = await apiClient.post('/api/teams', {
        name: formData.name,
        description: formData.description || null,
        isPublic: formData.isPublic,
        id: formData.teamId
      })
      if (result.success) {
        setCreateModalOpen(false)
        refetch()
        toast.success('团队创建成功')
        return true
      } else {
        toast.error(result.message || '创建失败')
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
        basePath="/student/team"
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
        onTabChange={(tab) => { setActiveTab(tab); setPage(1); router.push('/student/team?tab=' + tab, { scroll: false }) }}
        invitations={invitations}
        loadingInvitations={loadingInvitations}
        processingInvitation={processingInvitation}
        onAcceptInvitation={(id) => handleAcceptInvitation(id)}
        onRejectInvitation={(id) => handleRejectInvitation(id)}
        showCreateButton={user?.studentMode === 'personal'}
      />
    </>
  )
}
