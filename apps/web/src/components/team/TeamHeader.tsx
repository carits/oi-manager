'use client'

import ReactMarkdown from 'react-markdown'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Camera, ChevronLeft, Crown, Edit3, LockKeyhole, Megaphone, School, ShieldCheck, Users } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import type { TeamDetail } from '@/hooks/data/useTeamDetail'
import type { TeamPermission } from '@/hooks/useTeamPermission'
import apiClient from '@/lib/apiClient'
import { getAssetUrl } from '@/lib/assets'
import styles from './Team.module.css'

export interface TeamHeaderProps {
  team: TeamDetail
  permission: TeamPermission
  editingAnnouncement: boolean
  announcementText: string
  onAnnouncementTextChange: (text: string) => void
  onStartEditAnnouncement: () => void
  onCancelEditAnnouncement: () => void
  onSaveAnnouncement: () => Promise<void>
  savingAnnouncement: boolean
  onEditTeam: () => void
  onLeaveTeam: () => void
  onBack: () => void
  onApplyJoin?: () => void
  applyStatus?: string | null
  applying?: boolean
  onAvatarUpdate?: (avatarUrl: string) => void
}

export function TeamHeader({
  team,
  permission,
  editingAnnouncement,
  announcementText,
  onAnnouncementTextChange,
  onStartEditAnnouncement,
  onCancelEditAnnouncement,
  onSaveAnnouncement,
  savingAnnouncement,
  onEditTeam,
  onLeaveTeam,
  onBack,
  onApplyJoin,
  applyStatus,
  applying,
  onAvatarUpdate,
}: TeamHeaderProps) {
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('avatar', file)
      const result = await apiClient.post<{ avatar: string }>(`/api/teams/${team.id}/avatar`, formData)
      if (result.success && result.data) {
        onAvatarUpdate?.(result.data.avatar)
      } else {
        toast.error(result.message || '上传失败')
      }
    } catch (error) {
      console.error('Upload avatar error:', error)
      toast.error('上传失败')
    } finally {
      setUploadingAvatar(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const memberCount = (team.teachers?.length || 0) + (team.students?.length || 0)
  const adminCount = team.admins?.length || 0
  const ownerName = team.scope === 'personal'
    ? team.owner?.username || team.owner?.name || '-'
    : team.owner?.name || team.owner?.username || '-'
  const scopeLabel = team.scope === 'personal' ? '个人团队' : team.school?.name || '校园团队'
  const visibilityLabel = team.isPublic ? '公开' : '私有'

  return (
    <>
      <Button variant="ghost" type="button" className={styles.backLink} onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" />返回
      </Button>

      <section className={styles.teamOverviewCard}>
        <div className={styles.teamOverviewMain}>
          <div className={styles.teamOverviewAvatarWrap}>
            <div
              className={styles.teamOverviewAvatar}
              style={team.avatar ? { backgroundImage: `url(${getAssetUrl(team.avatar)})` } : undefined}
              aria-label={team.name}
            >
              {!team.avatar && team.name.charAt(0)}
            </div>
            {permission.isOwner && (
              <>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className={styles.hiddenInput} />
                <Button variant="ghost"
                  type="button"
                  className={styles.avatarEditButton}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  title="更换头像"
                  aria-label="更换团队头像"
                >
                  <Camera size={15} aria-hidden="true" />
                </Button>
              </>
            )}
          </div>

          <div className={styles.teamOverviewInfo}>
            <div className={styles.teamOverviewTitleLine}>
              <h1>{team.name}</h1>
              <span className={styles.roleTag}>{team.isPublic ? <Users size={14} aria-hidden="true" /> : <LockKeyhole size={14} aria-hidden="true" />}{visibilityLabel}</span>
            </div>
            <div className={styles.teamOverviewMeta}>
              <span><Crown size={14} aria-hidden="true" />所有者 {ownerName}</span>
              <span><School size={14} aria-hidden="true" />{scopeLabel}</span>
              <span><Users size={14} aria-hidden="true" />成员 {memberCount}</span>
              <span><ShieldCheck size={14} aria-hidden="true" />管理员 {adminCount}</span>
            </div>
            {team.description && <p className={styles.teamOverviewDescription}>{team.description}</p>}
          </div>
        </div>

        <div className={styles.teamOverviewActions}>
          {permission.isMember ? (
            <>
              {permission.canEdit && <Button variant="secondary" icon={<Edit3 size={16} />} onClick={onEditTeam}>编辑</Button>}
              <Button variant={permission.isOwner ? 'outline' : 'secondary'} onClick={onLeaveTeam} style={permission.isOwner ? { color: 'var(--danger)' } : undefined}>
                {permission.isOwner ? '解散团队' : '退出团队'}
              </Button>
            </>
          ) : onApplyJoin && team.isPublic ? (
            <Button onClick={onApplyJoin} disabled={applyStatus === 'pending' || applying} loading={applying}>
              {applyStatus === 'pending' ? '已申请' : '申请加入'}
            </Button>
          ) : null}
        </div>
      </section>

      <section className={styles.announcementCard}>
        <div className={styles.announcementHeader}>
          <div>
            <h2><Megaphone size={17} aria-hidden="true" />公告</h2>
            <p>团队说明、训练安排或成员须知。</p>
          </div>
          {permission.canEdit && !editingAnnouncement && <Button variant="secondary" size="sm" onClick={onStartEditAnnouncement}>编辑公告</Button>}
        </div>

        {editingAnnouncement ? (
          <div className={styles.announcementEditor}>
            <Textarea
              value={announcementText}
              onChange={(event) => onAnnouncementTextChange(event.target.value)}
              rows={6}
              placeholder="支持 Markdown 格式..."
            />
            <div className={styles.formActions}>
              <Button onClick={onSaveAnnouncement} loading={savingAnnouncement}>保存</Button>
              <Button variant="secondary" onClick={onCancelEditAnnouncement} disabled={savingAnnouncement}>取消</Button>
            </div>
          </div>
        ) : team.announcement ? (
          <div className={`markdown-content ${styles.announcementContent}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
              {team.announcement}
            </ReactMarkdown>
          </div>
        ) : (
          <div className={styles.announcementEmpty}>暂无公告</div>
        )}
      </section>
    </>
  )
}