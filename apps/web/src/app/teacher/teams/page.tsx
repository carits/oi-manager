'use client'

import { useState, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { TeamListPage, TeamItem, Invitation } from '@/components/team'
import { useTeams, Team } from '@/hooks/data/useTeams'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'

export default function TeamsPage() {
  const { user, sessionKey } = useAuth()
  const toast = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

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
  const queryParams = mounted ? {
    page,
    pageSize,
    schoolId: user?.schoolId,
    view: activeTab === 'mine' ? 'mine' : 'all'
  } : null

  const { data, loading, refetch } = useTeams(queryParams, sessionKey)

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
          apiClient.get<any[]>('/api/teams/admin-invitations'),
          apiClient.get<any[]>('/api/teams/member-invitations')
        ])
        const adminInvitations = (adminResult.success ? (adminResult.data || []) : []).map((i: any) => ({ ...i, type: 'admin' as const }))
        const memberInvitations = (memberResult.success ? (memberResult.data || []) : []).map((i: any) => ({ ...i, type: 'member' as const }))
        setInvitations([...adminInvitations, ...memberInvitations])
      } catch (error) {
        console.error('Failed to fetch invitations:', error)
      } finally {
        setLoadingInvitations(false)
      }
    }
    if (user?.role === 'teacher' || user?.role === 'school_principal') fetchData()
  }, [user?.role])

  // 接受邀请
  const handleAcceptInvitation = async (invitationId: string, type: 'admin' | 'member') => {
    try {
      setProcessingInvitation(invitationId)
      const endpoint = type === 'admin'
        ? `/api/teams/admin-invitations/${invitationId}/accept`
        : `/api/teams/member-invitations/${invitationId}/accept`
      const result = await apiClient.post(endpoint)
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
  const handleRejectInvitation = async (invitationId: string, type: 'admin' | 'member') => {
    try {
      setProcessingInvitation(invitationId)
      const endpoint = type === 'admin'
        ? `/api/teams/admin-invitations/${invitationId}/reject`
        : `/api/teams/member-invitations/${invitationId}/reject`
      const result = await apiClient.post(endpoint)
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
  const handleCreateTeam = async (data: { name: string; description: string; isPublic: boolean; teamId: string }) => {
    try {
      setCreating(true)
      const result = await apiClient.post('/api/teams', {
        name: data.name,
        description: data.description || null,
        isPublic: data.isPublic,
        id: data.teamId
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
    <ProtectedRoute requiredRole="teacher">
      <TeamListPage
        basePath="/teacher/teams"
        teams={teams}
        loading={loading}
        page={page}
        pageSize={pageSize}
        total={data?.total || 0}
        totalPages={data?.totalPages || 1}
        onPageChange={setPage}
        onPageSizeChange={(newSize) => { setPageSize(newSize); setPage(1) }}
        activeTab={activeTab}
        onTabChange={(tab) => { setActiveTab(tab); setPage(1); router.push('/teacher/teams?tab=' + tab, { scroll: false }) }}
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
    </ProtectedRoute>
  )
}