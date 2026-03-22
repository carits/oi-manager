'use client'

import { useState, useEffect } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { TeamListPage, TeamItem, Invitation } from '@/components/team'
import { useTeams, Team } from '@/hooks/data/useTeams'
import { useAuth } from '@/components/AuthProvider'
import { getAuthHeaders } from '@/lib/auth'

export default function TeamsPage() {
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // 分页状态
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [activeTab, setActiveTab] = useState<'mine' | 'all'>('mine')

  // 构建查询参数 - 后端会从 JWT token 中获取 teacherId
  const queryParams = mounted ? {
    page,
    pageSize,
    schoolId: user?.schoolId,
    view: activeTab === 'mine' ? 'mine' : 'all'
  } : null

  const { data, loading, refetch } = useTeams(queryParams)

  // 邀请相关状态
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loadingInvitations, setLoadingInvitations] = useState(true)
  const [processingInvitation, setProcessingInvitation] = useState<string | null>(null)

  // 创建团队弹窗
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  // 转换 Team 数据格式
  const teams: TeamItem[] = (data?.list || []).map((team: Team) => ({
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
        const [adminRes, memberRes] = await Promise.all([
          fetch('http://localhost:3001/api/teams/admin-invitations', { headers: getAuthHeaders() }),
          fetch('http://localhost:3001/api/teams/member-invitations', { headers: getAuthHeaders() })
        ])
        const adminResult = await adminRes.json()
        const memberResult = await memberRes.json()
        const adminInvitations = (adminResult.success ? adminResult.data : []).map((i: any) => ({ ...i, type: 'admin' as const }))
        const memberInvitations = (memberResult.success ? memberResult.data : []).map((i: any) => ({ ...i, type: 'member' as const }))
        setInvitations([...adminInvitations, ...memberInvitations])
      } catch (error) {
        console.error('Failed to fetch invitations:', error)
      } finally {
        setLoadingInvitations(false)
      }
    }
    if (user?.teacherId) fetchData()
  }, [user?.teacherId])

  // 接受邀请
  const handleAcceptInvitation = async (invitationId: string, type: 'admin' | 'member') => {
    try {
      setProcessingInvitation(invitationId)
      const endpoint = type === 'admin'
        ? `http://localhost:3001/api/teams/admin-invitations/${invitationId}/accept`
        : `http://localhost:3001/api/teams/member-invitations/${invitationId}/accept`
      const res = await fetch(endpoint, { method: 'POST', headers: getAuthHeaders() })
      const result = await res.json()
      if (result.success) {
        setInvitations(invitations.filter(i => i.id !== invitationId))
        refetch()
      } else {
        alert(result.message || '操作失败')
      }
    } catch (error) {
      alert('操作失败')
    } finally {
      setProcessingInvitation(null)
    }
  }

  // 拒绝邀请
  const handleRejectInvitation = async (invitationId: string, type: 'admin' | 'member') => {
    try {
      setProcessingInvitation(invitationId)
      const endpoint = type === 'admin'
        ? `http://localhost:3001/api/teams/admin-invitations/${invitationId}/reject`
        : `http://localhost:3001/api/teams/member-invitations/${invitationId}/reject`
      const res = await fetch(endpoint, { method: 'POST', headers: getAuthHeaders() })
      const result = await res.json()
      if (result.success) {
        setInvitations(invitations.filter(i => i.id !== invitationId))
      } else {
        alert(result.message || '操作失败')
      }
    } catch (error) {
      alert('操作失败')
    } finally {
      setProcessingInvitation(null)
    }
  }

  // 创建团队
  const handleCreateTeam = async (data: { name: string; description: string; isPublic: boolean }) => {
    try {
      setCreating(true)
      const res = await fetch('http://localhost:3001/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ name: data.name, description: data.description || null, isPublic: data.isPublic })
      })
      const result = await res.json()
      if (result.success) {
        setCreateModalOpen(false)
        refetch()
        alert('团队创建成功')
        return true
      } else {
        alert(result.message || '创建失败')
        return false
      }
    } catch (error) {
      alert('创建失败')
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
        onTabChange={(tab) => { setActiveTab(tab); setPage(1) }}
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
