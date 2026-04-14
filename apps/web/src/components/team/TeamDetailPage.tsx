'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { useTeamPermission, type UserType } from '@/hooks/useTeamPermission'
import { useTeamDetail } from '@/hooks/data/useTeamDetail'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useToast } from '@/components/ui/Toast'
import {
  TeamHeader,
  TeamMemberList,
  TeamInviteModal,
  TeamInviteListModal,
  TeamTransferModal,
  TeamEditModal,
  type JoinRequestItem
} from '@/components/team'
import TeamProblemListsTab from './TeamProblemListsTab'
import TeamTrainingList from '../training/TeamTrainingList'

type TabType = 'members' | 'mock' | 'training' | 'tasks'

interface TransferTarget {
  id: string
  name: string
  memberType: 'teacher' | 'student'
}

export interface TeamDetailPageProps {
  userType: 'teacher' | 'student'
  basePath: string
  requiredRole: string | string[]
}

export function TeamDetailPage({ userType, basePath, requiredRole }: TeamDetailPageProps) {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, sessionKey } = useAuth()
  const toast = useToast()
  const teamId = params.id as string
  const VALID_TABS = ['members', 'mock', 'training', 'tasks'] as const
  const [activeTab, setActiveTab] = useState<TabType>(
    VALID_TABS.includes(searchParams.get('tab') as TabType) ? (searchParams.get('tab') as TabType) : 'members'
  )
  const [mounted, setMounted] = useState(false)

  // 获取用户ID
  const userId = userType === 'teacher' ? user?.teacherId : user?.studentId

  // 使用公共 hook 获取团队数据
  const { team, loading, error, refetch, joinRequests: apiJoinRequests, fetchJoinRequests } = useTeamDetail(mounted ? teamId : null, true, sessionKey)

  // 使用公共 hook 计算权限
  const permission = useTeamPermission(team, userId, userType)

  // 编辑公告状态
  const [editingAnnouncement, setEditingAnnouncement] = useState(false)
  const [announcementText, setAnnouncementText] = useState('')
  const [savingAnnouncement, setSavingAnnouncement] = useState(false)

  // 弹窗状态
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showInviteListModal, setShowInviteListModal] = useState(false)
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [pendingInviteCount, setPendingInviteCount] = useState(0)

  // 转移所有权
  const [selectedTransferTarget, setSelectedTransferTarget] = useState<TransferTarget | null>(null)
  const [transferCandidates, setTransferCandidates] = useState<TransferTarget[]>([])

  // 申请加入状态
  const [applying, setApplying] = useState(false)

  // 团队头像状态
  const [teamAvatar, setTeamAvatar] = useState<string | null>(null)

  // 确认弹框状态
  const [showSetAdminConfirm, setShowSetAdminConfirm] = useState(false)
  const [setAdminTarget, setSetAdminTarget] = useState<{ id: string; name: string; userType: UserType } | null>(null)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [leaving, setLeaving] = useState(false)

  // 移除成员确认弹框状态
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string; userType: UserType } | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const tab = searchParams.get('tab') as TabType
    if (VALID_TABS.includes(tab as any)) setActiveTab(tab)
  }, [searchParams])

  // 同步公告文本
  useEffect(() => {
    if (team?.announcement) {
      setAnnouncementText(team.announcement)
    }
  }, [team?.announcement])

  // 同步团队头像
  useEffect(() => {
    if (team?.avatar) {
      setTeamAvatar(team.avatar)
    }
  }, [team?.avatar])

  // 获取待处理邀请数量
  useEffect(() => {
    if (team && permission.isAdmin) {
      fetchPendingInviteCount()
      fetchJoinRequests()
    }
  }, [team, permission.isAdmin])

  const fetchPendingInviteCount = async () => {
    try {
      const result = await apiClient.get<{ length: number }[]>(`/api/teams/${teamId}/pending-invites`)
      if (result.success && result.data) {
        setPendingInviteCount(result.data.length || 0)
      }
    } catch (error) {
      console.error('Failed to fetch pending invites:', error)
    }
  }

  // 公告相关
  const handleStartEditAnnouncement = useCallback(() => {
    setAnnouncementText(team?.announcement || '')
    setEditingAnnouncement(true)
  }, [team?.announcement])

  const handleCancelEditAnnouncement = useCallback(() => {
    setEditingAnnouncement(false)
    setAnnouncementText(team?.announcement || '')
  }, [team?.announcement])

  const handleSaveAnnouncement = useCallback(async () => {
    if (!team) return
    try {
      setSavingAnnouncement(true)
      const result = await apiClient.put(`/api/teams/${teamId}/announcement`, {
        announcement: announcementText
      })
      if (result.success) {
        setEditingAnnouncement(false)
        refetch()
      } else {
        toast.error(result.message || '保存失败')
      }
    } catch (error) {
      toast.error('保存失败')
    } finally {
      setSavingAnnouncement(false)
    }
  }, [team, teamId, announcementText, refetch])

  // 编辑团队
  const handleEditTeam = useCallback(() => {
    setShowEditModal(true)
  }, [])

  // 退出/解散团队 - 打开确认弹框
  const handleLeaveTeam = useCallback(() => {
    setShowLeaveConfirm(true)
  }, [])

  // 确认退出/解散团队
  const confirmLeaveTeam = useCallback(async () => {
    if (!team) return

    try {
      setLeaving(true)
      const result = await apiClient.post(`/api/teams/${teamId}/leave`)
      if (result.success) {
        router.push(basePath)
      } else {
        setShowLeaveConfirm(false)
        // 显示错误提示
        setTimeout(() => toast.error(result.message || '退出失败'), 100)
      }
    } catch (error) {
      console.error('Leave team error:', error)
      setShowLeaveConfirm(false)
      setTimeout(() => toast.error('退出失败'), 100)
    } finally {
      setLeaving(false)
    }
  }, [team, teamId, router, basePath])

  // 成员管理 - 打开移除确认弹框
  const handleRemoveMember = useCallback(async (memberId: string, memberName: string, userType: UserType) => {
    setRemoveTarget({ id: memberId, name: memberName, userType })
    setShowRemoveConfirm(true)
  }, [])

  // 确认移除成员
  const confirmRemoveMember = useCallback(async () => {
    if (!removeTarget) return

    try {
      const result = await apiClient.delete(`/api/teams/${teamId}/members/${removeTarget.id}?memberType=${removeTarget.userType}`)
      if (result.success) {
        refetch()
      } else {
        toast.error(result.message || '移除失败')
      }
    } catch (error) {
      console.error('Remove member error:', error)
      toast.error('移除失败')
    } finally {
      setShowRemoveConfirm(false)
      setRemoveTarget(null)
    }
  }, [teamId, refetch, removeTarget])

  // 设置管理员 - 打开确认弹框
  const handleSetAdmin = useCallback((memberId: string, memberName: string, userType: UserType) => {
    setSetAdminTarget({ id: memberId, name: memberName, userType })
    setShowSetAdminConfirm(true)
  }, [])

  // 确认设置管理员
  const confirmSetAdmin = useCallback(async () => {
    if (!setAdminTarget) return

    try {
      const result = await apiClient.post(`/api/teams/${teamId}/admins`, {
        memberId: setAdminTarget.id,
        memberType: setAdminTarget.userType
      })
      if (result.success) {
        toast.success('已设置为管理员')
        refetch()
        setShowSetAdminConfirm(false)
        setSetAdminTarget(null)
      } else {
        toast.error(result.message || '设置失败')
      }
    } catch (error) {
      console.error('Set admin error:', error)
      toast.error('设置失败')
    }
  }, [teamId, refetch, setAdminTarget])

  const handleTransferOwnership = useCallback((memberId: string, memberName: string, userType: UserType) => {
    const candidates: TransferTarget[] = [
      ...(team?.admins || []).map(a => ({
        id: a.id,
        name: a.name,
        memberType: (a.adminType || a.type) as 'teacher' | 'student'
      })),
      ...(team?.teachers || []).map(t => ({
        id: t.id,
        name: t.name,
        memberType: 'teacher' as const
      })),
      ...(team?.students || []).map(s => ({
        id: s.id,
        name: s.name,
        memberType: 'student' as const
      }))
    ]

    setSelectedTransferTarget({ id: memberId, name: memberName, memberType: userType })
    setTransferCandidates(candidates)
    setShowTransferModal(true)
  }, [team])

  // 邀请相关
  const handleOpenInviteModal = useCallback(() => {
    setShowInviteModal(true)
  }, [])

  const handleViewInvites = useCallback(() => {
    setShowInviteListModal(true)
  }, [])

  // 申请处理
  const handleApproveRequest = useCallback(async (requestId: string) => {
    try {
      const result = await apiClient.post(`/api/teams/join-requests/${requestId}/approve`)
      if (result.success) {
        fetchJoinRequests()
        refetch()
      } else {
        toast.error(result.message || '操作失败')
      }
    } catch (error) {
      console.error('Approve request error:', error)
      toast.error('操作失败')
    }
  }, [fetchJoinRequests, refetch])

  const handleRejectRequest = useCallback(async (requestId: string) => {
    try {
      const result = await apiClient.post(`/api/teams/join-requests/${requestId}/reject`)
      if (result.success) {
        fetchJoinRequests()
      } else {
        toast.error(result.message || '操作失败')
      }
    } catch (error) {
      console.error('Reject request error:', error)
      toast.error('操作失败')
    }
  }, [fetchJoinRequests])

  // 申请加入
  const handleApplyJoin = useCallback(async () => {
    if (!team) return
    try {
      setApplying(true)
      const result = await apiClient.post(`/api/teams/${teamId}/join-request`, {
        message: '我想加入这个团队'
      })
      if (result.success) {
        toast.success('申请已提交')
        refetch()
      } else {
        toast.error(result.message || '申请失败')
      }
    } catch (error) {
      toast.error('申请失败')
    } finally {
      setApplying(false)
    }
  }, [team, teamId, refetch])

  // 转换申请数据格式（API 返回统一的 user 字段）
  const joinRequestItems: JoinRequestItem[] = (apiJoinRequests || []).map(r => {
    const user = r.user || r.student
    return {
      id: r.id,
      message: r.message,
      createdAt: r.createdAt,
      user: {
        id: user?.id || '',
        name: user?.name || '未知',
        username: user?.username,
        avatar: user?.avatar,
        type: (r.type || 'student') as 'student' | 'teacher'
      }
    }
  })

  const tabs = [
    { key: 'members', label: '成员' },
    { key: 'mock', label: '比赛' },
    { key: 'training', label: '训练' },
    { key: 'tasks', label: '题单' }
  ]

  if (!mounted || loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>
        加载中...
      </div>
    )
  }

  if (error || !team) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>
        <p>{error || '团队不存在'}</p>
        <button onClick={() => router.push(basePath)}>返回团队列表</button>
      </div>
    )
  }

  // 是否显示申请加入按钮（非成员 + 公有团队）
  const showApplyButton = !permission.isMember && team.isPublic

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        {/* 团队头部 */}
        <TeamHeader
          team={{ ...team, avatar: teamAvatar || team.avatar }}
          permission={permission}
          editingAnnouncement={editingAnnouncement}
          announcementText={announcementText}
          onAnnouncementTextChange={setAnnouncementText}
          onStartEditAnnouncement={handleStartEditAnnouncement}
          onCancelEditAnnouncement={handleCancelEditAnnouncement}
          onSaveAnnouncement={handleSaveAnnouncement}
          savingAnnouncement={savingAnnouncement}
          onEditTeam={handleEditTeam}
          onLeaveTeam={handleLeaveTeam}
          onBack={() => router.back()}
          onApplyJoin={showApplyButton ? handleApplyJoin : undefined}
          applyStatus={showApplyButton ? team.requestStatus ?? null : null}
          applying={applying}
          onAvatarUpdate={(avatarUrl) => setTeamAvatar(avatarUrl)}
        />

        {/* Tab 导航 */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '1rem',
            background: 'white',
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: '1px solid var(--border)'
          }}
        >
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key as TabType); router.push(`${basePath}/${teamId}?tab=${tab.key}`, { scroll: false }) }}
              style={{
                padding: '0.5rem 1rem',
                background: activeTab === tab.key ? 'var(--primary)' : 'transparent',
                color: activeTab === tab.key ? 'white' : 'var(--gray-700)',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500,
                transition: 'all 0.2s'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        <div
          style={{
            background: 'white',
            borderRadius: '8px',
            padding: '1.5rem',
            border: '1px solid var(--border)',
            minHeight: '400px'
          }}
        >
          {/* 成员 Tab */}
          {activeTab === 'members' && (
            <TeamMemberList
              team={team}
              permission={permission}
              onRemoveMember={handleRemoveMember}
              onSetAdmin={handleSetAdmin}
              onTransferOwnership={handleTransferOwnership}
              onInviteMembers={permission.canInvite ? handleOpenInviteModal : undefined}
              onViewInvites={permission.isAdmin ? handleViewInvites : undefined}
              pendingInviteCount={pendingInviteCount}
              joinRequests={joinRequestItems}
              onApproveRequest={handleApproveRequest}
              onRejectRequest={handleRejectRequest}
            />
          )}

          {/* 模拟赛 Tab */}
          {activeTab === 'mock' && (
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>比赛</h2>
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>
                <p>暂无比赛</p>
                <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>(功能开发中)</p>
              </div>
            </div>
          )}

          {/* 训练 Tab */}
          {activeTab === 'training' && (
            <TeamTrainingList
              teamId={teamId}
              basePath={basePath}
              isAdmin={permission.isAdmin}
            />
          )}

          {/* 题单 Tab */}
          {activeTab === 'tasks' && (
            <TeamProblemListsTab
              teamId={teamId}
              basePath={basePath}
              canManage={permission.isAdmin}
              isOwner={permission.isOwner}
              userId={user?.userId}
            />
          )}
        </div>
      </div>

      {/* 邀请成员弹窗 */}
      <TeamInviteModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        teamId={teamId}
        onSuccess={() => {
          refetch()
          fetchPendingInviteCount()
        }}
      />

      {/* 邀请列表弹窗 */}
      <TeamInviteListModal
        isOpen={showInviteListModal}
        onClose={() => setShowInviteListModal(false)}
        teamId={teamId}
      />

      {/* 转移所有者弹窗 */}
      <TeamTransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        teamId={teamId}
        selectedTarget={selectedTransferTarget}
        candidates={transferCandidates}
        onSuccess={() => router.push(basePath)}
      />

      {/* 编辑团队弹窗 */}
      <TeamEditModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        teamId={teamId}
        initialData={{
          name: team.name,
          description: team.description || '',
          isPublic: team.isPublic,
          teamId: team.id || ''
        }}
        onSuccess={refetch}
      />

      {/* 设置管理员确认弹框 */}
      <ConfirmModal
        isOpen={showSetAdminConfirm}
        onClose={() => {
          setShowSetAdminConfirm(false)
          setSetAdminTarget(null)
        }}
        onConfirm={confirmSetAdmin}
        title="设置管理员"
        message={`确定要将 ${setAdminTarget?.name || ''} 设为管理员吗？`}
        confirmText="确认设置"
      />

      {/* 退出/解散团队确认弹框 */}
      <ConfirmModal
        isOpen={showLeaveConfirm}
        onClose={() => setShowLeaveConfirm(false)}
        onConfirm={confirmLeaveTeam}
        title={permission.isOwner ? '解散团队' : '退出团队'}
        message={permission.isOwner ? '团队中已无其他成员，退出后将解散该团队。确定要退出吗？' : '确定要退出该团队吗？'}
        confirmText="确认退出"
        danger
        loading={leaving}
      />

      {/* 移除成员确认弹框 */}
      <ConfirmModal
        isOpen={showRemoveConfirm}
        onClose={() => {
          setShowRemoveConfirm(false)
          setRemoveTarget(null)
        }}
        onConfirm={confirmRemoveMember}
        title="移除成员"
        message={`确定要移除 ${removeTarget?.name || ''} 吗？`}
        confirmText="确认移除"
        danger
      />
    </div>
  )
}