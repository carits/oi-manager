'use client'

import { useState } from 'react'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Globe2, LockKeyhole, Mail, Plus } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { FormField } from '@/components/ui/FormField'
import { FormDialog } from '@/components/ui/Dialogs'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Pagination } from '@/components/ui/Pagination'
import { Tabs } from '@/components/ui/Tabs'
import { InvitationCard, type Invitation } from './InvitationCard'
import { TeamCard } from './TeamCard'
import { LoadError } from '@/components/ui/LoadError'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import styles from './Team.module.css'

export interface TeamItem {
  id: string
  name: string
  avatar?: string | null
  description?: string | null
  isPublic?: boolean
  school?: { id: string; name: string } | null
  owner?: { id: string; name?: string; username?: string } | null
  _count?: { members: number; teacherMembers?: number; admins?: number }
  requestStatus?: string | null
}

interface TeamListPageProps {
  basePath: string
  teams: TeamItem[]
  loading: boolean
  error?: string | null
  onRetry?: () => void
  page?: number
  pageSize?: number
  total?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  activeTab: 'mine' | 'all'
  onTabChange: (tab: 'mine' | 'all') => void
  invitations?: Invitation[]
  loadingInvitations?: boolean
  processingInvitation?: string | null
  onAcceptInvitation?: (id: string, type: 'admin' | 'member') => void
  onRejectInvitation?: (id: string, type: 'admin' | 'member') => void
  showCreateButton?: boolean
  onCreateTeam?: (data: { name: string; description: string; isPublic: boolean; teamId: string }) => Promise<boolean>
  createModalOpen?: boolean
  onOpenCreateModal?: () => void
  onCloseCreateModal?: () => void
  creating?: boolean
}

export function TeamListPage({
  basePath, teams, loading, error, onRetry, page = 1, pageSize = 12, total = 0,
  totalPages = 1, onPageChange, onPageSizeChange, activeTab, onTabChange,
  invitations = [], loadingInvitations = false, processingInvitation = null,
  onAcceptInvitation, onRejectInvitation, showCreateButton = true, onCreateTeam,
  createModalOpen = false, onOpenCreateModal, onCloseCreateModal, creating = false,
}: TeamListPageProps) {
  const { user } = useAuth()
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createIsPublic, setCreateIsPublic] = useState(true)
  const [createTeamId, setCreateTeamId] = useState('')
  const studentView = basePath.startsWith('/personal')
  const personalMode = basePath.startsWith('/personal')
  const trimmedCreateTeamId = createTeamId.trim()
  const createTeamIdInvalid = trimmedCreateTeamId.length > 0 && !/^[a-zA-Z0-9_]+$/.test(trimmedCreateTeamId)
  const canCreateTeam = Boolean(createName.trim() && trimmedCreateTeamId && !createTeamIdInvalid)

  const closeCreate = () => {
    setCreateName('')
    setCreateDescription('')
    setCreateIsPublic(true)
    setCreateTeamId('')
    onCloseCreateModal?.()
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canCreateTeam || !onCreateTeam) return
    const success = await onCreateTeam({ name: createName.trim(), description: createDescription.trim(), isPublic: createIsPublic, teamId: trimmedCreateTeamId })
    if (success) closeCreate()
  }

  return (
    <PageFrame>
      <PageHeader
        title="团队"
        description={personalMode ? '个人模式团队与校园团队相互独立。' : studentView ? '查看已加入的团队或浏览可加入团队。' : '维护负责的团队、成员与训练内容。'}
        actions={showCreateButton && onCreateTeam ? <Button icon={<Plus size={17} />} onClick={onOpenCreateModal}>创建团队</Button> : undefined}
      />

      {!loadingInvitations && invitations.length > 0 && onAcceptInvitation && onRejectInvitation && (
        <section className={styles.invitationSection} aria-labelledby="pending-invitations">
          <h2 className={styles.sectionLabel} id="pending-invitations"><Mail size={18} aria-hidden="true" />待处理邀请 ({invitations.length})</h2>
          {invitations.map(invitation => <InvitationCard key={invitation.id} invitation={invitation} onAccept={onAcceptInvitation} onReject={onRejectInvitation} processing={processingInvitation === invitation.id} />)}
        </section>
      )}

      <Tabs
        label="团队范围"
        value={activeTab}
        onChange={onTabChange}
        items={[{ value: 'mine', label: '我的团队' }, { value: 'all', label: studentView ? '浏览团队' : '全部团队' }]}
      />

      {loading ? <SkeletonRegion rows={6} label="团队列表正在准备" /> : error ? <LoadError message={error} onRetry={onRetry || (() => undefined)} /> : teams.length === 0 ? (
        <Empty title={activeTab === 'mine' ? '还没有加入团队' : '没有可浏览的团队'} description={activeTab === 'mine' ? '收到邀请或加入团队后会显示在这里。' : '可以稍后重试或调整范围。'} />
      ) : (
        <>
          <div className={styles.teamGrid}>
            {teams.map(team => <TeamCard key={team.id} id={team.id} name={team.name} avatar={team.avatar} description={team.description} memberCount={team._count?.members || 0} schoolName={team.school?.name || (personalMode ? '个人团队' : undefined)} ownerName={personalMode ? team.owner?.username || team.owner?.name : team.owner?.name || team.owner?.username} isPublic={team.isPublic} basePath={basePath} />)}
          </div>
          {totalPages > 1 && onPageChange && <Pagination currentPage={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />}
        </>
      )}

      <FormDialog
        isOpen={createModalOpen && Boolean(onCreateTeam)}
        onClose={closeCreate}
        title="创建团队"
        size="md"
        closeOnOverlay={!creating}
        footer={(
          <div className={styles.modalActionBar}>
            <span>{canCreateTeam ? '准备创建团队' : '请填写团队名称和合法团队标识'}</span>
            <div className={styles.modalActions}>
              <Button variant="secondary" onClick={closeCreate} disabled={creating}>取消</Button>
              <Button type="submit" form="create-team-form" loading={creating} disabled={!canCreateTeam}>创建团队</Button>
            </div>
          </div>
        )}
      >
        <form id="create-team-form" className={styles.dialogForm} onSubmit={submit}>
          <FormField label="团队名称" required><Input value={createName} onChange={event => setCreateName(event.target.value)} required placeholder="例如：2026 暑期集训队" /></FormField>
          <FormField label="团队标识" required hint="仅支持英文字母、数字和下划线，创建后不可修改。" error={createTeamIdInvalid ? '团队标识只能包含英文字母、数字和下划线。' : undefined}><Input value={createTeamId} onChange={event => setCreateTeamId(event.target.value)} required maxLength={50} placeholder="summer_2026" /></FormField>
          <FormField label="团队说明"><Textarea value={createDescription} onChange={event => setCreateDescription(event.target.value)} rows={3} placeholder="说明训练方向或加入要求" /></FormField>
          <fieldset className={styles.dialogFieldset}><legend>加入方式</legend><div className={styles.visibilityOptions}>
            <label className={styles.visibilityOption}><Input type="radio" name="visibility" checked={createIsPublic} onChange={() => setCreateIsPublic(true)} /><Globe2 size={18} /><span>公开<br /><small>其他用户可以申请加入</small></span></label>
            <label className={styles.visibilityOption}><Input type="radio" name="visibility" checked={!createIsPublic} onChange={() => setCreateIsPublic(false)} /><LockKeyhole size={18} /><span>私有<br /><small>仅通过邀请加入</small></span></label>
          </div></fieldset>
        </form>
      </FormDialog>
    </PageFrame>
  )
}
