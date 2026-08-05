'use client'

import type { TeamDetail } from '@/hooks/data/useTeamDetail'
import type { TeamPermission, UserType } from '@/hooks/useTeamPermission'
import { Button } from '@/components/ui/Button'
import { UserIdentityLink } from '@/components/profile/UserIdentityLink'

export interface JoinRequestItem {
  id: string
  message?: string | null
  createdAt?: string
  user: {
    id: string
    name: string
    username?: string
    avatar?: string | null
    userType: UserType
  }
}

export interface TeamMemberListProps {
  team: TeamDetail
  permission: TeamPermission
  onRemoveMember?: (memberId: string, memberName: string, userType: UserType) => void
  onSetAdmin?: (memberId: string, memberName: string, userType: UserType) => void
  onTransferOwnership?: (memberId: string, memberName: string, userType: UserType) => void
  // 邀请功能
  onInviteMembers?: () => void
  onViewInvites?: () => void
  pendingInviteCount?: number
  // 申请管理
  joinRequests?: JoinRequestItem[]
  onApproveRequest?: (requestId: string) => void
  onRejectRequest?: (requestId: string) => void
}

export function TeamMemberList({
  team,
  permission,
  onRemoveMember,
  onSetAdmin,
  onTransferOwnership,
  onInviteMembers,
  onViewInvites,
  pendingInviteCount,
  joinRequests,
  onApproveRequest,
  onRejectRequest
}: TeamMemberListProps) {
  const canRemove = permission.canRemove
  const canTransfer = permission.canTransfer

  // 获取所有者ID
  const ownerId = team.owner?.id

  // 只有所有者才能设置管理员
  const canSetAdmin = permission.isOwner

  // 所有者
  const owner = team.owner ? {
    id: team.owner.id,
    name: team.owner.name || '未知',
    username: team.owner.username,
    avatar: team.owner.avatar,
    userType: (team.owner.type || team.ownerType) as UserType
  } : null

  // 管理员列表（排除所有者）
  const admins = (team.admins || [])
    .filter(admin => admin.id !== ownerId)
    .map(admin => ({
      id: admin.id,
      name: admin.name,
      username: admin.username,
      avatar: admin.avatar,
      userType: (admin.adminType || admin.type) as UserType
    }))

  // 普通成员列表（排除所有者和管理员）
  const members: Array<{
    id: string
    name: string
    username?: string
    avatar?: string | null
    joinedAt?: string | null
    userType: UserType
  }> = []

  // 添加普通教师成员
  team.teachers?.forEach(teacher => {
    const isAdmin = team.admins?.some(a => a.id === teacher.id && (a.adminType === 'teacher' || a.type === 'teacher'))
    const isOwner = teacher.id === ownerId && (team.owner?.type === 'teacher' || team.ownerType === 'teacher')
    if (!isAdmin && !isOwner) {
      members.push({
        id: teacher.id,
        name: teacher.name,
        username: teacher.username,
        avatar: teacher.avatar,
        joinedAt: teacher.joinedAt,
        userType: 'teacher'
      })
    }
  })

  // 添加普通学生成员
  team.students?.forEach(student => {
    const isAdmin = team.admins?.some(a => a.id === student.id && (a.adminType === 'student' || a.type === 'student'))
    const isOwner = student.id === ownerId && (team.owner?.type === 'student' || team.ownerType === 'student')
    if (!isAdmin && !isOwner) {
      members.push({
        id: student.id,
        name: student.name,
        username: student.username,
        avatar: student.avatar,
        joinedAt: student.joinedAt,
        userType: (student.type || (team.scope === 'personal' ? 'user' : 'student')) as UserType
      })
    }
  })

  // 渲染单个成员行（无角色标签）
  const renderMemberRow = (
    member: { id: string; name: string; username?: string; avatar?: string | null; userType: UserType; joinedAt?: string | null },
    role: 'owner' | 'admin' | 'member'
  ) => {
    const canRemoveThis = canRemove && role !== 'owner' && (permission.isOwner || role === 'member')
    const canSetAdminThis = canSetAdmin && (permission.isOwner || role === 'member')
    const canTransferThis = canTransfer && role !== 'owner'

    return (
      <div
        key={`${member.userType}-${member.id}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--border)',
          gap: '0.75rem'
        }}
      >
        {/* 头像 */}
        <UserIdentityLink
          id={member.id}
          userType={member.userType}
          name={member.name}
          username={member.username}
          avatar={member.avatar}
          avatarOnly
          size={40}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <UserIdentityLink
              id={member.id}
              userType={member.userType}
              name={member.name}
              username={member.username}
              showUsername
              style={{ color: 'var(--gray-900)' }}
            />
            <span
              style={{
                padding: '0.125rem 0.375rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                background: member.userType === 'teacher' ? 'var(--blue-100)' : member.userType === 'student' ? 'var(--green-100)' : 'var(--gray-100)',
                color: member.userType === 'teacher' ? 'var(--blue-700)' : member.userType === 'student' ? 'var(--green-700)' : 'var(--gray-700)'
              }}
            >
              {member.userType === 'teacher' ? '教师' : member.userType === 'student' ? '学生' : '用户'}
            </span>
          </div>
        </div>

        {/* 操作按钮 */}
        {role !== 'owner' && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {canTransferThis && onTransferOwnership && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onTransferOwnership(member.id, member.name, member.userType)}
              >
                转移所有权
              </Button>
            )}
            {canSetAdminThis && role === 'member' && onSetAdmin && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onSetAdmin(member.id, member.name, member.userType)}
              >
                设为管理员
              </Button>
            )}
            {canRemoveThis && onRemoveMember && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onRemoveMember(member.id, member.name, member.userType)}
                style={{ color: 'var(--danger)' }}
              >
                移除
              </Button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* 头部：标题和管理按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        {permission.canInvite && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {onViewInvites && (
              <Button variant="secondary" size="sm" onClick={onViewInvites}>
                邀请列表{pendingInviteCount !== undefined && pendingInviteCount > 0 && ` (${pendingInviteCount})`}
              </Button>
            )}
            {onInviteMembers && (
              <Button variant="primary" size="sm" onClick={onInviteMembers}>
                邀请成员
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 待处理申请 */}
      {joinRequests && joinRequests.length > 0 && permission.canManageRequests && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '0.875rem', color: 'var(--gray-500)', marginBottom: '0.5rem' }}>
            待处理申请 ({joinRequests.length})
          </h3>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {joinRequests.map(request => (
              <div
                key={request.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem',
                  background: 'var(--warning-light)',
                  borderRadius: '6px'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <UserIdentityLink
                      id={request.user.id}
                      userType={request.user.userType}
                      name={request.user.name}
                      username={request.user.username}
                      showUsername
                    />
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '0.125rem 0.375rem',
                      borderRadius: '4px',
                      background: request.user.userType === 'teacher' ? 'var(--blue-100)' : request.user.userType === 'student' ? 'var(--green-100)' : 'var(--gray-100)',
                      color: request.user.userType === 'teacher' ? 'var(--blue-700)' : request.user.userType === 'student' ? 'var(--green-700)' : 'var(--gray-700)'
                    }}>
                      {request.user.userType === 'teacher' ? '教师' : request.user.userType === 'student' ? '学生' : '用户'}
                    </span>
                  </div>
                  {request.message && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)', marginTop: '0.25rem' }}>
                      留言: {request.message}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => onApproveRequest?.(request.id)}
                  >
                    同意
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onRejectRequest?.(request.id)}
                  >
                    拒绝
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 所有者分组 */}
      {owner && (
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--gray-700)' }}>
            所有者 (1)
          </h3>
          <div
            style={{
              background: 'white',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              overflow: 'hidden'
            }}
          >
            {renderMemberRow(owner, 'owner')}
          </div>
        </div>
      )}

      {/* 管理员分组 */}
      {admins.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--gray-700)' }}>
            管理员 ({admins.length})
          </h3>
          <div
            style={{
              background: 'white',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              overflow: 'hidden'
            }}
          >
            {admins.map(admin => renderMemberRow(admin, 'admin'))}
          </div>
        </div>
      )}

      {/* 成员分组 */}
      {members.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--gray-700)' }}>
            成员 ({members.length})
          </h3>
          <div
            style={{
              background: 'white',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              overflow: 'hidden'
            }}
          >
            {members.map(member => renderMemberRow(member, 'member'))}
          </div>
        </div>
      )}

      {/* 无成员提示 */}
      {!owner && admins.length === 0 && members.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
          暂无成员
        </div>
      )}
    </div>
  )
}
