'use client'

import { useEffect, useState } from 'react'
import { Search, UserPlus } from 'lucide-react'
import { FormDialog } from '@/components/ui/Dialogs'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'
import { useAuth } from '@/components/AuthProvider'
import { usePathname } from 'next/navigation'
import { isPersonalPath } from '@/lib/workspacePath'
import { UserIdentityLink } from '@/components/profile/UserIdentityLink'
import styles from './Team.module.css'

interface AvailableMember {
  id: string
  name: string
  username?: string
  avatar?: string | null
  memberType: 'teacher' | 'student' | 'user'
}

interface SelectedMember {
  id: string
  memberType: 'teacher' | 'student' | 'user'
}

interface TeamInviteModalProps {
  isOpen: boolean
  onClose: () => void
  teamId: string
  onSuccess: () => void
}

function memberTypeLabel(type: AvailableMember['memberType']) {
  if (type === 'teacher') return '教师'
  if (type === 'student') return '学生'
  return '用户'
}

function memberTypeClass(type: AvailableMember['memberType']) {
  if (type === 'teacher') return styles.typeTeacher
  if (type === 'student') return styles.typeStudent
  return styles.typeUser
}

export function TeamInviteModal({ isOpen, onClose, teamId, onSuccess }: TeamInviteModalProps) {
  const toast = useToast()
  const pathname = usePathname()
  const { user } = useAuth()
  const [availableMembers, setAvailableMembers] = useState<AvailableMember[]>([])
  const [selectedMembers, setSelectedMembers] = useState<SelectedMember[]>([])
  const [usernameInput, setUsernameInput] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [inviting, setInviting] = useState(false)
  const [loadingMembers, setLoadingMembers] = useState(false)

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
      setLoadingMembers(true)
      const params = new URLSearchParams()
      if (keyword) params.set('keyword', keyword)
      const result = await apiClient.get<{ teachers: any[]; students: any[]; users?: any[] }>(`/api/teams/${teamId}/available-members?${params}`)
      if (result.success && result.data) {
        const teachers = (result.data.teachers || []).map((t: any) => ({ ...t, memberType: 'teacher' as const }))
        const students = (result.data.students || []).map((s: any) => ({ ...s, memberType: 'student' as const }))
        const users = (result.data.users || []).map((candidate: any) => ({ ...candidate, memberType: 'user' as const }))
        setAvailableMembers([...users, ...teachers, ...students])
      }
    } catch (error) {
      console.error('Failed to fetch available members:', error)
      setAvailableMembers([])
    } finally {
      setLoadingMembers(false)
    }
  }

  const toggleMember = (member: AvailableMember, checked: boolean) => {
    if (checked) {
      setSelectedMembers(current => [...current, { id: member.id, memberType: member.memberType }])
    } else {
      setSelectedMembers(current => current.filter(item => !(item.id === member.id && item.memberType === member.memberType)))
    }
  }

  const handleInvite = async () => {
    if (selectedMembers.length === 0 && !usernameInput.trim()) return

    try {
      setInviting(true)
      const members = selectedMembers.map(m => ({ id: m.id, type: m.memberType }))
      const result = await apiClient.post<any>(`/api/teams/${teamId}/members`, {
        members,
        usernames: usernameInput.trim() ? usernameInput.split(',').map(s => s.trim()).filter(Boolean) : [],
      })
      if (result.success) {
        const successCount = result.data?.invited?.length || members.length
        toast.success(`成功发送 ${successCount} 个邀请`)
        onClose()
        onSuccess()
      } else {
        toast.error(result.message || '邀请失败')
      }
    } catch (error) {
      console.error('Invite members error:', error)
      toast.error('邀请失败')
    } finally {
      setInviting(false)
    }
  }

  const manualCount = usernameInput.split(',').map(item => item.trim()).filter(Boolean).length
  const totalSelected = selectedMembers.length + manualCount

  return (
    <FormDialog
      isOpen={isOpen}
      onClose={onClose}
      title="邀请成员"
      size="lg"
      footer={
        <div className={styles.modalActionBar}>
          <span>{totalSelected > 0 ? `已选择 ${totalSelected} 人` : '选择候选人或输入用户名后发送邀请'}</span>
          <div className={styles.modalActions}>
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button icon={<UserPlus size={16} />} onClick={handleInvite} disabled={totalSelected === 0 || inviting} loading={inviting}>发送邀请</Button>
          </div>
        </div>
      }
    >
      <div className={styles.inviteDialog}>
        <section className={styles.inviteSearchSection}>
          <label className={styles.fieldLabel} htmlFor="team-invite-search">搜索成员</label>
          <div className={styles.searchInputWrap}>
            <Search size={16} aria-hidden="true" />
            <input
              id="team-invite-search"
              type="text"
              placeholder="输入姓名或用户名"
              value={searchKeyword}
              onChange={(event) => {
                const value = event.target.value
                setSearchKeyword(value)
                void fetchAvailableMembers(value)
              }}
            />
          </div>
          <div className={styles.candidateList}>
            {loadingMembers ? (
              <div className={styles.modalEmpty}>正在加载候选成员</div>
            ) : availableMembers.length > 0 ? (
              availableMembers.map(member => {
                const checked = selectedMembers.some(item => item.id === member.id && item.memberType === member.memberType)
                return (
                  <label key={`${member.memberType}-${member.id}`} className={styles.candidateRow} data-selected={checked || undefined}>
                    <input type="checkbox" checked={checked} onChange={(event) => toggleMember(member, event.target.checked)} />
                    <UserIdentityLink
                      id={member.id}
                      userType={member.memberType}
                      name={member.name}
                      username={member.username}
                      avatar={member.avatar}
                      avatarOnly
                      size={34}
                    />
                    <span className={styles.candidateMain}>
                      <UserIdentityLink id={member.id} userType={member.memberType} name={member.name} username={member.username} showUsername />
                    </span>
                    <span className={`${styles.memberTag} ${memberTypeClass(member.memberType)}`}>{memberTypeLabel(member.memberType)}</span>
                  </label>
                )
              })
            ) : (
              <div className={styles.modalEmpty}>{searchKeyword ? '没有找到成员' : '暂无可邀请的成员'}</div>
            )}
          </div>
        </section>

        <section className={styles.manualInviteSection}>
          <label className={styles.fieldLabel} htmlFor="team-invite-usernames">按用户名批量邀请</label>
          <input
            id="team-invite-usernames"
            className={styles.textInput}
            type="text"
            placeholder="user1, user2, user3"
            value={usernameInput}
            onChange={(event) => setUsernameInput(event.target.value)}
          />
          <p>{isPersonalPath(pathname) ? '仅可邀请已启用个人身份的用户。' : '仅可邀请本校成员，多个用户名请用英文逗号分隔。'}</p>
        </section>
      </div>
    </FormDialog>
  )
}