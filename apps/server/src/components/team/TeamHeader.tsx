'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { TeamDetail } from '@/hooks/data/useTeamDetail'
import { TeamPermission } from '@/hooks/useTeamPermission'
import { getAuthHeaders } from '@/lib/auth'

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
  // 学生端申请加入
  onApplyJoin?: () => void
  applyStatus?: string | null
  applying?: boolean
  // 头像更新回调
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
  onAvatarUpdate
}: TeamHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingAvatar(true)
    try {
      const formData = new FormData()
      formData.append('avatar', file)

      const res = await fetch(`http://localhost:3001/api/teams/${team.id}/avatar`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      })

      const data = await res.json()
      if (data.success) {
        onAvatarUpdate?.(data.data.avatar)
      } else {
        alert(data.message || '上传失败')
      }
    } catch (error) {
      console.error('Upload avatar error:', error)
      alert('上传失败')
    } finally {
      setUploadingAvatar(false)
      // 清空 input 以便可以重复选择同一文件
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <>
      {/* 返回按钮 */}
      <div style={{ marginBottom: '1rem' }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.875rem', padding: 0 }}
        >
          ← 返回
        </button>
      </div>

      {/* 团队头部信息 */}
      <div
        style={{
          background: 'white',
          borderRadius: '8px',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          border: '1px solid var(--border)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ position: 'relative' }}>
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '12px',
                background: team.avatar
                  ? `url(http://localhost:3001${team.avatar}) center/cover`
                  : 'linear-gradient(135deg, var(--primary), #6366f1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontWeight: 700,
                fontSize: '2rem'
              }}
            >
              {!team.avatar && team.name.charAt(0)}
            </div>
            {/* 头像上传按钮 - 仅所有者可见 */}
            {permission.isOwner && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  style={{
                    position: 'absolute',
                    bottom: '-4px',
                    right: '-4px',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: 'var(--primary)',
                    color: 'white',
                    border: '2px solid white',
                    cursor: uploadingAvatar ? 'not-allowed' : 'pointer',
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: uploadingAvatar ? 0.7 : 1
                  }}
                  title="更换头像"
                >
                  📷
                </button>
              </>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>{team.name}</h1>
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--gray-500)' }}>
              <span>类型: {team.isPublic ? '公有' : '私有'}</span>
              <span>|</span>
              <span>
                所有者: {team.owner?.name || '-'}
                {team.owner?.username && (
                  <span style={{ color: 'var(--gray-400)' }}> ({team.owner.username})</span>
                )}
              </span>
              <span>|</span>
              <span>{team.school.name}</span>
            </div>
          </div>

          {/* 操作按钮 */}
          {permission.isMember ? (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {permission.canEdit && (
                <Button variant="secondary" onClick={onEditTeam}>
                  编辑
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={onLeaveTeam}
                style={{ color: permission.isOwner ? 'var(--danger)' : 'var(--gray-600)' }}
              >
                {permission.isOwner ? '解散团队' : '退出团队'}
              </Button>
            </div>
          ) : onApplyJoin && team.isPublic ? (
            // 非成员且是公有团队，显示申请加入按钮
            <Button
              onClick={onApplyJoin}
              disabled={applyStatus === 'pending' || applying}
              style={{ minWidth: '100px' }}
            >
              {applying ? '申请中...' : applyStatus === 'pending' ? '已申请' : '申请加入'}
            </Button>
          ) : null}
        </div>

        {/* 团队描述 */}
        {team.description && (
          <p style={{ marginTop: '1rem', color: 'var(--gray-600)', fontSize: '0.875rem', lineHeight: 1.6 }}>
            {team.description}
          </p>
        )}
      </div>

      {/* 公告区域 */}
      <div
        style={{
          background: 'white',
          borderRadius: '8px',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          border: '1px solid var(--border)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>公告</h2>
          {permission.canEdit && !editingAnnouncement && (
            <Button variant="secondary" size="sm" onClick={onStartEditAnnouncement}>
              编辑
            </Button>
          )}
        </div>

        {editingAnnouncement ? (
          <div>
            <textarea
              value={announcementText}
              onChange={(e) => onAnnouncementTextChange(e.target.value)}
              rows={6}
              style={{
                width: '100%',
                padding: '0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '0.875rem',
                resize: 'vertical',
                fontFamily: 'inherit'
              }}
              placeholder="支持 Markdown 格式..."
            />
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <Button onClick={onSaveAnnouncement} disabled={savingAnnouncement}>
                {savingAnnouncement ? '保存中...' : '保存'}
              </Button>
              <Button variant="secondary" onClick={onCancelEditAnnouncement}>
                取消
              </Button>
            </div>
          </div>
        ) : team.announcement ? (
          <div className="markdown-content" style={{ fontSize: '0.875rem', lineHeight: 1.6 }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
            >
              {team.announcement}
            </ReactMarkdown>
          </div>
        ) : (
          <p style={{ color: 'var(--gray-400)', fontSize: '0.875rem' }}>暂无公告</p>
        )}
      </div>
    </>
  )
}
