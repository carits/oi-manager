'use client'

import { Check, Crown, Mail, ShieldCheck, UserPlus, Users, X } from 'lucide-react'
import unifiedStyles from './TeamMemberList.unified.module.css'
import type { TeamDetail } from '@/hooks/data/useTeamDetail'
import type { TeamPermission, UserType } from '@/hooks/useTeamPermission'
import { Button } from '@/components/ui/Button'
import { UserIdentityLink } from '@/components/profile/UserIdentityLink'
import styles from './Team.module.css'

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
  onInviteMembers?: () => void
  onViewInvites?: () => void
  pendingInviteCount?: number
  joinRequests?: JoinRequestItem[]
  onApproveRequest?: (requestId: string) => void
  onRejectRequest?: (requestId: string) => void
}

interface MemberView {
  id: string
  name: string
  username?: string
  avatar?: string | null
  joinedAt?: string | null
  userType: UserType
}

function memberTypeLabel(userType: UserType) {
  if (userType === 'teacher') return '教师'
  if (userType === 'student') return '学生'
  return '用户'
}

function memberTypeClass(userType: UserType) {
  if (userType === 'teacher') return styles.typeTeacher
  if (userType === 'student') return styles.typeStudent
  return styles.typeUser
}

function roleLabel(role: 'owner' | 'admin' | 'member') {
  if (role === 'owner') return '所有者'
  if (role === 'admin') return '管理员'
  return '成员'
}

function roleIcon(role: 'owner' | 'admin' | 'member') {
  if (role === 'owner') return <Crown size={15} aria-hidden="true" />
  if (role === 'admin') return <ShieldCheck size={15} aria-hidden="true" />
  return <Users size={15} aria-hidden="true" />
}

function formatDate(value?: string | null) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
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
  joinRequests = [],
  onApproveRequest,
  onRejectRequest,
}: TeamMemberListProps) {
  const canRemove = permission.canRemove
  const canTransfer = permission.canTransfer
  const ownerId = team.owner?.id
  const canSetAdmin = permission.isOwner

  const owner: MemberView | null = team.owner ? {
    id: team.owner.id,
    name: team.owner.name || '未知',
    username: team.owner.username,
    avatar: team.owner.avatar,
    userType: (team.owner.type || team.ownerType) as UserType,
  } : null

  const admins: MemberView[] = (team.admins || [])
    .filter(admin => admin.id !== ownerId)
    .map(admin => ({
      id: admin.id,
      name: admin.name,
      username: admin.username,
      avatar: admin.avatar,
      userType: (admin.adminType || admin.type) as UserType,
    }))

  const members: MemberView[] = []

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
        userType: 'teacher',
      })
    }
  })

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
        userType: (student.type || (team.scope === 'personal' ? 'user' : 'student')) as UserType,
      })
    }
  })

  const totalPeople = (owner ? 1 : 0) + admins.length + members.length

  const renderMemberRow = (member: MemberView, role: 'owner' | 'admin' | 'member') => {
    const canRemoveThis = canRemove && role !== 'owner' && (permission.isOwner || role === 'member')
    const canSetAdminThis = canSetAdmin && role === 'member'
    const canTransferThis = canTransfer && role !== 'owner'
    const joinedAt = formatDate(member.joinedAt)

    return (
      <div key={`${member.userType}-${member.id}`} className={styles.memberRow}>
        <UserIdentityLink
          id={member.id}
          userType={member.userType}
          name={member.name}
          username={member.username}
          avatar={member.avatar}
          avatarOnly
          size={40}
        />
        <div className={styles.memberMain}>
          <div className={styles.memberNameLine}>
            <UserIdentityLink
              id={member.id}
              userType={member.userType}
              name={member.name}
              username={member.username}
              showUsername
              className={unifiedStyles.u1}
            />
            <span className={`${styles.memberTag} ${memberTypeClass(member.userType)}`}>{memberTypeLabel(member.userType)}</span>
            <span className={styles.roleTag}>{roleIcon(role)}{roleLabel(role)}</span>
          </div>
          {joinedAt && <div className={styles.memberMeta}>加入于 {joinedAt}</div>}
        </div>
        {role !== 'owner' && (canTransferThis || canSetAdminThis || canRemoveThis) && (
          <div className={styles.memberActions}>
            {canTransferThis && onTransferOwnership && (
              <Button variant="secondary" size="sm" onClick={() => onTransferOwnership(member.id, member.name, member.userType)}>转移所有权</Button>
            )}
            {canSetAdminThis && onSetAdmin && (
              <Button variant="secondary" size="sm" onClick={() => onSetAdmin(member.id, member.name, member.userType)}>设为管理员</Button>
            )}
            {canRemoveThis && onRemoveMember && (
              <Button variant="outline" size="sm" onClick={() => onRemoveMember(member.id, member.name, member.userType)} className={unifiedStyles.u2}>移除</Button>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderSection = (title: string, count: number, rows: React.ReactNode) => (
    <section className={styles.memberSection}>
      <div className={styles.memberSectionHeader}>
        <h3>{title}</h3>
        <span>{count}</span>
      </div>
      <div className={styles.memberTable}>{rows}</div>
    </section>
  )

  return (
    <div className={styles.memberPanel}>
      <div className={styles.memberToolbar}>
        <div>
          <h2 className={styles.memberTitle}>团队成员</h2>
          <div className={styles.memberSummary}>
            <span>共 {totalPeople} 人</span>
            <span>所有者 {owner ? 1 : 0}</span>
            <span>管理员 {admins.length}</span>
            <span>成员 {members.length}</span>
            {permission.canManageRequests && <span>待处理 {joinRequests.length}</span>}
          </div>
        </div>
        {permission.canInvite && (
          <div className={styles.memberToolbarActions}>
            {onViewInvites && (
              <Button variant="secondary" size="sm" icon={<Mail size={15} />} onClick={onViewInvites}>
                邀请列表{pendingInviteCount !== undefined && pendingInviteCount > 0 ? ` (${pendingInviteCount})` : ''}
              </Button>
            )}
            {onInviteMembers && (
              <Button variant="primary" size="sm" icon={<UserPlus size={15} />} onClick={onInviteMembers}>邀请成员</Button>
            )}
          </div>
        )}
      </div>

      {joinRequests.length > 0 && permission.canManageRequests && (
        <section className={styles.requestPanel}>
          <div className={styles.requestHeader}>
            <div>
              <h3>待处理申请</h3>
              <p>审核想加入团队的用户，处理后会自动更新成员列表。</p>
            </div>
            <span>{joinRequests.length}</span>
          </div>
          <div className={styles.requestList}>
            {joinRequests.map(request => (
              <div key={request.id} className={styles.requestRow}>
                <UserIdentityLink
                  id={request.user.id}
                  userType={request.user.userType}
                  name={request.user.name}
                  username={request.user.username}
                  avatar={request.user.avatar}
                  avatarOnly
                  size={38}
                />
                <div className={styles.requestMain}>
                  <div className={styles.memberNameLine}>
                    <UserIdentityLink
                      id={request.user.id}
                      userType={request.user.userType}
                      name={request.user.name}
                      username={request.user.username}
                      showUsername
                    />
                    <span className={`${styles.memberTag} ${memberTypeClass(request.user.userType)}`}>{memberTypeLabel(request.user.userType)}</span>
                  </div>
                  <div className={styles.memberMeta}>{request.message ? `留言：${request.message}` : '没有留言'}</div>
                </div>
                <div className={styles.requestActions}>
                  <Button variant="primary" size="sm" icon={<Check size={15} />} onClick={() => onApproveRequest?.(request.id)}>同意</Button>
                  <Button variant="outline" size="sm" icon={<X size={15} />} onClick={() => onRejectRequest?.(request.id)}>拒绝</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {owner && renderSection('所有者', 1, renderMemberRow(owner, 'owner'))}
      {admins.length > 0 && renderSection('管理员', admins.length, admins.map(admin => renderMemberRow(admin, 'admin')))}
      {members.length > 0 && renderSection('成员', members.length, members.map(member => renderMemberRow(member, 'member')))}

      {!owner && admins.length === 0 && members.length === 0 && (
        <div className={styles.memberEmpty}>暂无成员</div>
      )}
    </div>
  )
}