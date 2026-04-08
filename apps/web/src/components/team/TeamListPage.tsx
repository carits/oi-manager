'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { TeamCard, InvitationCard, Invitation } from '@/components/team'
import { formStyles } from '@/lib/styles'

export interface TeamItem {
  id: string
  name: string
  avatar?: string | null
  description?: string | null
  isPublic?: boolean
  school: { id: string; name: string }
  owner?: { id: string; name: string } | null
  _count?: {
    members: number
    teacherMembers?: number
    admins?: number
  }
  requestStatus?: string | null // 用于学生端申请状态
}

interface TeamListPageProps {
  // 基础配置
  basePath: string // 团队详情页路径前缀

  // 数据
  teams: TeamItem[]
  loading: boolean

  // 分页
  page?: number
  pageSize?: number
  total?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void

  // Tab 切换
  activeTab: 'mine' | 'all'
  onTabChange: (tab: 'mine' | 'all') => void

  // 邀请
  invitations?: Invitation[]
  loadingInvitations?: boolean
  processingInvitation?: string | null
  onAcceptInvitation?: (id: string, type: 'admin' | 'member') => void
  onRejectInvitation?: (id: string, type: 'admin' | 'member') => void

  // 创建团队
  showCreateButton?: boolean
  onCreateTeam?: (data: { name: string; description: string; isPublic: boolean; teamId: string }) => Promise<boolean>

  // 创建团队弹窗
  createModalOpen?: boolean
  onOpenCreateModal?: () => void
  onCloseCreateModal?: () => void
  creating?: boolean
}

export function TeamListPage({
  basePath,
  teams,
  loading,
  page = 1,
  pageSize = 12,
  total = 0,
  totalPages = 1,
  onPageChange,
  onPageSizeChange,
  activeTab,
  onTabChange,
  invitations = [],
  loadingInvitations = false,
  processingInvitation = null,
  onAcceptInvitation,
  onRejectInvitation,
  showCreateButton = true,
  onCreateTeam,
  createModalOpen = false,
  onOpenCreateModal,
  onCloseCreateModal,
  creating = false
}: TeamListPageProps) {
  // 创建团队表单状态
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createIsPublic, setCreateIsPublic] = useState(true)
  const [createTeamId, setCreateTeamId] = useState('')

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createName.trim() || !onCreateTeam) return

    const success = await onCreateTeam({
      name: createName.trim(),
      description: createDescription.trim(),
      isPublic: createIsPublic,
      teamId: createTeamId.trim() || undefined
    })
    if (success) {
      setCreateName('')
      setCreateDescription('')
      setCreateIsPublic(true)
      setCreateTeamId('')
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* 页面标题 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>团队管理</h1>
        {showCreateButton && onCreateTeam && (
          <Button onClick={() => {
            setCreateName('')
            setCreateDescription('')
            setCreateIsPublic(true)
            onOpenCreateModal?.()
          }}>+ 创建团队</Button>
        )}
      </div>

      {/* 邀请通知区域 */}
      {!loadingInvitations && invitations.length > 0 && onAcceptInvitation && onRejectInvitation && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.75rem', color: 'var(--gray-700)' }}>
            📩 待处理邀请 ({invitations.length})
          </h2>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {invitations.map(invitation => (
              <InvitationCard
                key={invitation.id}
                invitation={invitation}
                onAccept={onAcceptInvitation}
                onReject={onRejectInvitation}
                processing={processingInvitation === invitation.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          onClick={() => onTabChange('mine')}
          style={{
            padding: '0.5rem 1rem',
            background: activeTab === 'mine' ? 'var(--primary)' : 'white',
            color: activeTab === 'mine' ? 'white' : 'var(--gray-700)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: activeTab === 'mine' ? 600 : 400
          }}
        >
          我的团队
        </button>
        <button
          onClick={() => onTabChange('all')}
          style={{
            padding: '0.5rem 1rem',
            background: activeTab === 'all' ? 'var(--primary)' : 'white',
            color: activeTab === 'all' ? 'white' : 'var(--gray-700)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: activeTab === 'all' ? 600 : 400
          }}
        >
          全部团队
        </button>
      </div>

      {/* 团队卡片列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>
          加载中...
        </div>
      ) : teams.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>
          {activeTab === 'mine' ? '您还没有加入任何团队' : '暂无团队数据'}
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1rem'
          }}>
            {teams.map(team => {
              // _count.members 已经是所有 active 成员的数量
              const memberCount = team._count?.members || 0

              return (
                <TeamCard
                  key={team.id}
                  id={team.id}
                  name={team.name}
                  avatar={team.avatar}
                  description={team.description}
                  memberCount={memberCount}
                  schoolName={team.school.name}
                  ownerName={team.owner?.name}
                  isPublic={team.isPublic}
                  basePath={basePath}
                />
              )
            })}
          </div>

          {/* 分页 */}
          {totalPages > 1 && onPageChange && (
            <div style={{ marginTop: '1.5rem', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                onPageChange={onPageChange}
                onPageSizeChange={onPageSizeChange}
              />
            </div>
          )}
        </>
      )}

      {/* 创建团队弹窗 */}
      {createModalOpen && onCreateTeam && (
        <Modal
          isOpen={true}
          onClose={() => {
            setCreateName('')
            setCreateDescription('')
            setCreateIsPublic(true)
            onCloseCreateModal?.()
          }}
          title="创建团队"
          width="500px"
        >
          <form onSubmit={handleCreateSubmit} style={{ display: 'grid', gap: '1rem' }}>
            <div style={formStyles.field}>
              <label style={formStyles.label}>团队名称 *</label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                required
                style={formStyles.input}
                placeholder="请输入团队名称"
              />
            </div>

            <div style={formStyles.field}>
              <label style={formStyles.label}>团队描述</label>
              <textarea
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                rows={3}
                style={formStyles.textarea}
                placeholder="请输入团队描述（选填）"
              />
            </div>

            <div style={formStyles.field}>
              <label style={formStyles.label}>团队ID *</label>
              <input
                type="text"
                value={createTeamId}
                onChange={(e) => {
                  const val = e.target.value
                  // 只允许英文、数字、下划线
                  if (/^[a-zA-Z0-9_]*$/.test(val)) {
                    setCreateTeamId(val)
                  }
                }}
                required
                style={formStyles.input}
                placeholder="如 team_2024（必填，创建后不可修改）"
                maxLength={50}
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.25rem' }}>
                只能包含英文字母、数字和下划线，用于外部平台统一标识
              </p>
            </div>

            <div style={formStyles.field}>
              <label style={formStyles.label}>团队类型</label>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="createIsPublic"
                    checked={createIsPublic}
                    onChange={() => setCreateIsPublic(true)}
                  />
                  <span>🌐 公有团队</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="createIsPublic"
                    checked={!createIsPublic}
                    onChange={() => setCreateIsPublic(false)}
                  />
                  <span>🔒 私有团队</span>
                </label>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.5rem' }}>
                公有团队：其他用户可以浏览并申请加入<br />
                私有团队：只能通过邀请加入
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
              <Button type="submit" disabled={creating || !createName.trim() || !createTeamId.trim()} style={{ flex: 1 }}>
                {creating ? '创建中...' : '创建'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => {
                setCreateName('')
                setCreateDescription('')
                onCloseCreateModal?.()
              }} style={{ flex: 1 }}>
                取消
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}