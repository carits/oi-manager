'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import { getAssetUrl } from '@/lib/assets'

interface PendingInvite {
  id: string
  type: 'student' | 'teacher' | 'teacher-member'
  role: 'admin' | 'member'
  invitedAt: string
  invitedByName: string
  user: {
    id: string
    name: string
    username?: string
    avatar?: string | null
    type: 'teacher' | 'student'
  }
}

interface TeamInviteListModalProps {
  isOpen: boolean
  onClose: () => void
  teamId: string
}

export function TeamInviteListModal({ isOpen, onClose, teamId }: TeamInviteListModalProps) {
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchInviteList()
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

  const handleCancelInvite = async (invite: PendingInvite) => {
    if (!confirm('确定要取消该邀请吗？')) return

    try {
      let endpoint = ''
      if (invite.type === 'student') {
        endpoint = `/api/teams/${teamId}/invites/${invite.id}`
      } else if (invite.type === 'teacher-member') {
        endpoint = `/api/teams/${teamId}/teacher-invites/${invite.id}`
      } else {
        endpoint = `/api/teams/${teamId}/admin-invites/${invite.id}`
      }

      const result = await apiClient.delete(endpoint)
      if (result.success) {
        fetchInviteList()
      } else {
        alert(result.message || '取消失败')
      }
    } catch (error) {
      console.error('Cancel invite error:', error)
      alert('取消失败')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="邀请列表" width="500px">
      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
          加载中...
        </div>
      ) : pendingInvites.length > 0 ? (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {pendingInvites.map(invite => (
            <div
              key={invite.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.75rem',
                background: 'var(--gray-50)',
                borderRadius: '8px',
                border: '1px solid var(--border)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: invite.user.avatar
                      ? `url(${getAssetUrl(invite.user.avatar)}) center/cover`
                      : 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontWeight: 500
                  }}
                >
                  {!invite.user.avatar && invite.user.name.charAt(0)}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 500 }}>{invite.user.name}</span>
                    {invite.user.username && (
                      <span style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>({invite.user.username})</span>
                    )}
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '0.125rem 0.375rem',
                      borderRadius: '4px',
                      background: invite.user.type === 'teacher' ? 'var(--blue-100)' : 'var(--green-100)',
                      color: invite.user.type === 'teacher' ? 'var(--blue-700)' : 'var(--green-700)'
                    }}>
                      {invite.user.type === 'teacher' ? '教师' : '学生'}
                    </span>
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '0.125rem 0.375rem',
                      borderRadius: '4px',
                      background: 'var(--gray-100)',
                      color: 'var(--gray-700)'
                    }}>
                      {invite.role === 'admin' ? '管理员' : '成员'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                    邀请人: {invite.invitedByName} · {new Date(invite.invitedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleCancelInvite(invite)}
                style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
              >
                取消邀请
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ textAlign: 'center', color: 'var(--gray-500)', padding: '2rem' }}>
          暂无待处理的邀请
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
        <Button variant="secondary" onClick={onClose}>
          关闭
        </Button>
      </div>
    </Modal>
  )
}