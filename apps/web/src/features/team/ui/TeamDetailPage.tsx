'use client'

import { useEffect, useState, useCallback } from 'react'
import unifiedStyles from './TeamDetailPage.unified.module.css'
import { Button } from '@/components/ui/Button'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/features/auth'
import {
  decideTeamJoinRequest,
  leaveTeam,
  listPendingTeamInvites,
  removeTeamMember,
  requestToJoinTeam,
  setTeamAdmin,
  updateTeamAnnouncement,
  useTeamDetail,
  useTeamPermission,
  type UserType,
} from '@/features/team'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useToast } from '@/components/ui/Toast'
import { TeamMemberList } from './TeamMemberList'
import { TeamInviteModal } from './TeamInviteModal'
import { TeamInviteListModal } from './TeamInviteListModal'
import { TeamTransferModal } from './TeamTransferModal'
import { TeamEditModal } from './TeamEditModal'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { LoadError } from '@/components/ui/LoadError'
import type { JoinRequestItem } from './TeamMemberList'
import dynamic from 'next/dynamic'
import styles from './Team.module.css'
import { TeamActivityOverview } from './TeamActivityOverview'

// TeamHeader 包含 react-markdown + katex (~3MB)，延迟加载（命名导出）
const TeamHeader = dynamic(() => import('./TeamHeader').then(mod => mod.TeamHeader))
interface TransferTarget {
  id: string
  name: string
  memberType: UserType
}

export interface TeamDetailPageProps {
  userType: UserType
  basePath: string
  requiredRole: string | string[]
  teamIdOverride?: string
}

export function TeamDetailPage({ userType, basePath, requiredRole, teamIdOverride }: TeamDetailPageProps) {
  const params = useParams()
  const router = useRouter()
  const { user, sessionKey } = useAuth()
  const toast = useToast()
  const teamId = teamIdOverride || (params.id as string)
  // 获取用户ID
  const userId = user?.userId

  // 使用公共 hook 获取团队数据
  const { team, loading, error, refetch, joinRequests: apiJoinRequests, fetchJoinRequests } = useTeamDetail(teamId, true, sessionKey)

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
      setPendingInviteCount((await listPendingTeamInvites(teamId)).length)
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
      const result = await updateTeamAnnouncement(teamId, announcementText)
      if (result.ok) {
        setEditingAnnouncement(false)
        refetch()
      } else {
        toast.error(result.error.userMessage || '保存失败')
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
      const result = await leaveTeam(teamId)
      if (result.ok) {
        router.push(basePath)
      } else {
        setShowLeaveConfirm(false)
        // 显示错误提示
        setTimeout(() => toast.error(result.error.userMessage || '退出失败'), 100)
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
      const result = await removeTeamMember(teamId, removeTarget.id, removeTarget.userType)
      if (result.ok) {
        refetch()
      } else {
        toast.error(result.error.userMessage || '移除失败')
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
      const result = await setTeamAdmin(teamId, setAdminTarget.id, setAdminTarget.userType)
      if (result.ok) {
        toast.success('已设置为管理员')
        refetch()
        setShowSetAdminConfirm(false)
        setSetAdminTarget(null)
      } else {
        toast.error(result.error.userMessage || '设置失败')
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
        memberType: (a.adminType || a.type) as UserType
      })),
      ...(team?.teachers || []).map(t => ({
        id: t.id,
        name: t.name,
        memberType: 'teacher' as const
      })),
      ...(team?.students || []).map(s => ({
        id: s.id,
        name: s.name,
        memberType: (s.type || (team?.scope === 'personal' ? 'user' : 'student')) as UserType
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
      const result = await decideTeamJoinRequest(requestId, 'approve')
      if (result.ok) {
        fetchJoinRequests()
        refetch()
      } else {
        toast.error(result.error.userMessage || '操作失败')
      }
    } catch (error) {
      console.error('Approve request error:', error)
      toast.error('操作失败')
    }
  }, [fetchJoinRequests, refetch])

  const handleRejectRequest = useCallback(async (requestId: string) => {
    try {
      const result = await decideTeamJoinRequest(requestId, 'reject')
      if (result.ok) {
        fetchJoinRequests()
      } else {
        toast.error(result.error.userMessage || '操作失败')
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
      const result = await requestToJoinTeam(teamId, '我想加入这个团队')
      if (result.ok) {
        toast.success('申请已提交')
        refetch()
      } else {
        toast.error(result.error.userMessage || '申请失败')
      }
    } catch (error) {
      toast.error('申请失败')
    } finally {
      setApplying(false)
    }
  }, [team, teamId, refetch])

  // 转换申请数据格式（API 返回统一的 user 字段）
  const joinRequestItems: JoinRequestItem[] = (apiJoinRequests || []).map(r => {
    const user = r.user
    return {
      id: r.id,
      message: r.message,
      createdAt: r.createdAt,
      user: {
        id: user?.id || '',
        name: user?.name || '未知',
        username: user?.username,
        avatar: user?.avatar,
        userType: (user?.userType || (team?.scope === 'personal' ? 'user' : 'student')) as UserType
      }
    }
  })

  if (loading) {
    return (
      <div className={unifiedStyles.u1}>
        <SkeletonRegion rows={8} label="正在获取团队详情" />
      </div>
    )
  }

  if (error || !team) {
    return (
      <div className={unifiedStyles.u1}>
        <LoadError
          message={error || '团队不存在'}
          onRetry={refetch}
          onBack={() => router.push(basePath)}
        />
      </div>
    )
  }

  // 是否显示申请加入按钮（非成员 + 公有团队）
  const showApplyButton = !permission.isMember && team.isPublic

  return (
    <div className={styles.teamDetailShell}>
      <div className={styles.teamDetailInner}>
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
          onBack={() => router.push(basePath)}
          onApplyJoin={showApplyButton ? handleApplyJoin : undefined}
          applyStatus={showApplyButton ? team.requestStatus ?? null : null}
          applying={applying}
          onAvatarUpdate={(avatarUrl) => setTeamAvatar(avatarUrl)}
        />

        <div className={styles.teamDetailContent}>
          <TeamActivityOverview teamId={teamId} workspaceBase={basePath.replace(/\/teams$/, '')} />
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
