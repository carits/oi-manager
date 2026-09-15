'use client'

import { useEffect, useState } from 'react'
import collisionStyles from './TeamInviteListModal.collision.module.css'
import unifiedStyles from './TeamInviteListModal.unified.module.css'
import { CalendarDays, Trash2 } from 'lucide-react'
import { DetailDialog } from '@/components/ui/Dialogs'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'
import { UserIdentityLink } from '@/features/user-profile'
import styles from './Team.module.css'

interface PendingInvite {
  id: string
  type: 'student' | 'teacher' | 'user'
  role: 'admin' | 'member'
  invitedAt: string
  invitedByName: string
  user: {
    id: string
    name: string
    username?: string
    avatar?: string | null
  }
}

interface TeamInviteListModalProps {
  isOpen: boolean
  onClose: () => void
  teamId: string
}

function inviteeTypeLabel(type: PendingInvite['type']) {
  if (type === 'teacher') return '教师'
  if (type === 'student') return '学生'
  return '用户'
}

function inviteeTypeClass(type: PendingInvite['type']) {
  if (type === 'teacher') return styles.typeTeacher
  if (type === 'student') return styles.typeStudent
  return styles.typeUser
}

export function TeamInviteListModal({ isOpen, onClose, teamId }: TeamInviteListModalProps) {
  const toast = useToast()
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<PendingInvite | null>(null)

  useEffect(() => {
    if (isOpen) {
      void fetchInviteList()
    }
  }, [isOpen])

  const fetchInviteList = async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<PendingInvite[]>(`/api/teams/${teamId}/pending-invites`)
      if (result.success && result.data) {
        setPendingInvites(result.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch invite list:', error)
      setPendingInvites([])
    } finally {
      setLoading(false)
    }
  }

  const handleCancelInvite = (invite: PendingInvite) => {
    setCancelTarget(invite)
    setShowCancelConfirm(true)
  }

  const confirmCancelInvite = async () => {
    if (!cancelTarget) return

    try {
      const result = await apiClient.delete(`/api/teams/${teamId}/invites/${cancelTarget.id}`)
      if (result.success) {
        void fetchInviteList()
      } else {
        toast.error(result.message || '取消失败')
      }
    } catch (error) {
      console.error('Cancel invite error:', error)
      toast.error('取消失败')
    } finally {
      setShowCancelConfirm(false)
      setCancelTarget(null)
    }
  }

  return (
    <>
      <DetailDialog
        isOpen={isOpen}
        onClose={onClose}
        title="邀请列表"
        size="lg"
        footer={
          <div className={styles.modalActionBar}>
            <span>{pendingInvites.length > 0 ? `待处理邀请 ${pendingInvites.length} 个` : '暂无待处理邀请'}</span>
            <Button variant="secondary" onClick={onClose}>关闭</Button>
          </div>
        }
      >
        {loading ? (
          <div className={styles.modalEmpty}><span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></div>
        ) : pendingInvites.length > 0 ? (
          <div className={styles.inviteList}>
            {pendingInvites.map(invite => {
              const user = invite.user || { id: '', name: '未知用户', username: '' }
              const inviteeType = invite.type
              return (
                <div key={invite.id} className={styles.inviteRow}>
                  <UserIdentityLink
                    id={user.id}
                    userType={inviteeType}
                    name={user.name}
                    username={user.username}
                    avatar={user.avatar}
                    avatarOnly
                    size={38}
                  />
                  <div className={styles.inviteMain}>
                    <div className={styles.memberNameLine}>
                      <UserIdentityLink id={user.id} userType={inviteeType} name={user.name} username={user.username} showUsername />
                      <span className={`${styles.memberTag} ${inviteeTypeClass(inviteeType)}`}>{inviteeTypeLabel(inviteeType)}</span>
                      <span className={styles.roleTag}>{invite.role === 'admin' ? '管理员' : '成员'}</span>
                    </div>
                    <div className={styles.memberMeta}>
                      <CalendarDays size={13} aria-hidden="true" /> 邀请人 {invite.invitedByName} · {new Date(invite.invitedAt).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<Trash2 size={15} />}
                    onClick={() => handleCancelInvite(invite)}
                    className={unifiedStyles.u1}
                  >
                    取消邀请
                  </Button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className={styles.modalEmpty}>暂无待处理的邀请</div>
        )}
      </DetailDialog>

      <ConfirmModal
        isOpen={showCancelConfirm}
        onClose={() => {
          setShowCancelConfirm(false)
          setCancelTarget(null)
        }}
        onConfirm={confirmCancelInvite}
        title="取消邀请"
        message={`确定要取消对 ${cancelTarget?.user?.name || '该用户'} 的邀请吗？`}
        confirmText="确认取消"
        danger
      />
    </>
  )
}