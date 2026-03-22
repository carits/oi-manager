'use client'

import { useState, useEffect } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { TeamListPage, TeamItem, Invitation } from '@/components/team'
import { useTeams, Team } from '@/hooks/data/useTeams'
import { useAuth } from '@/components/AuthProvider'
import { getAuthHeaders } from '@/lib/auth'

// 学生端 - 团队管理页面
export default function StudentTeamPage() {
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // 分页状态
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [activeTab, setActiveTab] = useState<'mine' | 'all'>('mine')

  // 构建查询参数 - 后端会从 JWT token 中获取 studentId
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

  // 获取邀请列表 - 后端会从 JWT token 中获取 studentId
  useEffect(() => {
    const fetchInvitations = async () => {
      if (!mounted || !user?.studentId) return
      try {
        setLoadingInvitations(true)
        const res = await fetch(`http://localhost:3001/api/teams/student/${user.studentId}`, {
          headers: getAuthHeaders()
        })
        const data = await res.json()
        if (data.success) {
          const pending = (data.data.pending || []).map((inv: any) => ({
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
  }, [mounted, user?.studentId])

  // 接受邀请
  const handleAcceptInvitation = async (invitationId: string) => {
    try {
      setProcessingInvitation(invitationId)
      const res = await fetch(`http://localhost:3001/api/teams/invitations/${invitationId}/accept`, {
        method: 'POST',
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        setInvitations(invitations.filter(i => i.id !== invitationId))
        refetch()
      } else {
        alert(data.message || '操作失败')
      }
    } catch (error) {
      alert('操作失败')
    } finally {
      setProcessingInvitation(null)
    }
  }

  // 拒绝邀请
  const handleRejectInvitation = async (invitationId: string) => {
    try {
      setProcessingInvitation(invitationId)
      const res = await fetch(`http://localhost:3001/api/teams/invitations/${invitationId}/reject`, {
        method: 'POST',
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        setInvitations(invitations.filter(i => i.id !== invitationId))
      } else {
        alert(data.message || '操作失败')
      }
    } catch (error) {
      alert('操作失败')
    } finally {
      setProcessingInvitation(null)
    }
  }

  // 创建团队
  const handleCreateTeam = async (formData: { name: string; description: string; isPublic: boolean }) => {
    if (!formData.name.trim()) {
      alert('请输入团队名称')
      return false
    }

    try {
      setCreating(true)
      const res = await fetch('http://localhost:3001/api/teams', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          isPublic: formData.isPublic
        })
      })
      const data = await res.json()
      if (data.success) {
        setCreateModalOpen(false)
        refetch()
        alert('团队创建成功')
        return true
      } else {
        alert(data.message || '创建失败')
        return false
      }
    } catch (error) {
      alert('创建失败')
      return false
    } finally {
      setCreating(false)
    }
  }

  if (!mounted) {
    return (
      <ProtectedRoute requiredRole="student">
        <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>
          加载中...
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute requiredRole="student">
      <TeamListPage
        basePath="/student/team"
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
        onAcceptInvitation={(id) => handleAcceptInvitation(id)}
        onRejectInvitation={(id) => handleRejectInvitation(id)}
        onCreateTeam={handleCreateTeam}
        createModalOpen={createModalOpen}
        onOpenCreateModal={() => setCreateModalOpen(true)}
        onCloseCreateModal={() => setCreateModalOpen(false)}
        creating={creating}
      />
    </ProtectedRoute>
  )
}
