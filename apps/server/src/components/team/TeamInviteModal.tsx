'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { getAuthHeaders } from '@/lib/auth'

interface AvailableMember {
  id: string
  name: string
  username?: string
  avatar?: string | null
  memberType: 'teacher' | 'student'
}

interface SelectedMember {
  id: string
  memberType: 'teacher' | 'student'
}

interface TeamInviteModalProps {
  isOpen: boolean
  onClose: () => void
  teamId: string
  onSuccess: () => void
}

export function TeamInviteModal({ isOpen, onClose, teamId, onSuccess }: TeamInviteModalProps) {
  const [availableMembers, setAvailableMembers] = useState<AvailableMember[]>([])
  const [selectedMembers, setSelectedMembers] = useState<SelectedMember[]>([])
  const [usernameInput, setUsernameInput] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [inviting, setInviting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchAvailableMembers()
      setSelectedMembers([])
      setUsernameInput('')
      setSearchKeyword('')
    }
  }, [isOpen])

  const fetchAvailableMembers = async (keyword?: string) => {
    try {
      const params = new URLSearchParams()
      if (keyword) params.set('keyword', keyword)
      const res = await fetch(`http://localhost:3001/api/teams/${teamId}/available-members?${params}`, {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        const teachers = (data.data.teachers || []).map((t: any) => ({ ...t, memberType: 'teacher' as const }))
        const students = (data.data.students || []).map((s: any) => ({ ...s, memberType: 'student' as const }))
        setAvailableMembers([...teachers, ...students])
      }
    } catch (error) {
      console.error('Failed to fetch available members:', error)
    }
  }

  const handleInvite = async () => {
    if (selectedMembers.length === 0 && !usernameInput.trim()) return

    try {
      setInviting(true)
      const members = selectedMembers.map(m => ({ id: m.id, type: m.memberType }))

      const res = await fetch(`http://localhost:3001/api/teams/${teamId}/members`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          members,
          usernames: usernameInput.trim() ? usernameInput.split(',').map(s => s.trim()).filter(Boolean) : []
        })
      })
      const data = await res.json()
      if (data.success) {
        const successCount = data.data?.invited?.length || members.length
        alert(`成功发送 ${successCount} 个邀请`)
        onClose()
        onSuccess()
      } else {
        alert(data.message || '邀请失败')
      }
    } catch (error) {
      console.error('Invite members error:', error)
      alert('邀请失败')
    } finally {
      setInviting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="邀请成员" width="500px">
      {/* 搜索 */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>搜索成员</h4>
        <input
          type="text"
          placeholder="搜索成员..."
          value={searchKeyword}
          onChange={(e) => {
            setSearchKeyword(e.target.value)
            fetchAvailableMembers(e.target.value)
          }}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            marginBottom: '0.5rem'
          }}
        />
        <div style={{ maxHeight: '280px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
          {availableMembers.length > 0 ? (
            availableMembers.map(member => (
              <label
                key={`${member.memberType}-${member.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedMembers.some(m => m.id === member.id && m.memberType === member.memberType)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedMembers([...selectedMembers, { id: member.id, memberType: member.memberType }])
                    } else {
                      setSelectedMembers(selectedMembers.filter(m => !(m.id === member.id && m.memberType === member.memberType)))
                    }
                  }}
                />
                <span style={{ fontWeight: 500 }}>{member.name}</span>
                {member.username && (
                  <span style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>({member.username})</span>
                )}
                <span style={{ fontSize: '0.75rem', padding: '0.125rem 0.375rem', background: member.memberType === 'teacher' ? 'var(--blue-100)' : 'var(--green-100)', color: member.memberType === 'teacher' ? 'var(--blue-700)' : 'var(--green-700)', borderRadius: '4px' }}>
                  {member.memberType === 'teacher' ? '教师' : '学生'}
                </span>
              </label>
            ))
          ) : (
            <p style={{ padding: '1rem', textAlign: 'center', color: 'var(--gray-500)' }}>
              {searchKeyword ? '没有找到成员' : '暂无可邀请的成员'}
            </p>
          )}
        </div>
      </div>

      {/* 用户名邀请 */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>用户名邀请用户（逗号分割）</h4>
        <input
          type="text"
          placeholder="user1, user2, user3"
          value={usernameInput}
          onChange={(e) => setUsernameInput(e.target.value)}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '6px'
          }}
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.25rem' }}>
          注：只能邀请本校成员
        </p>
      </div>

      {/* 已选 */}
      {selectedMembers.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>
            已选: {selectedMembers.length} 名成员
          </p>
        </div>
      )}

      {/* 按钮 */}
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button
          onClick={handleInvite}
          disabled={(selectedMembers.length === 0 && !usernameInput.trim()) || inviting}
        >
          {inviting ? '发送中...' : '发送邀请'}
        </Button>
      </div>
    </Modal>
  )
}