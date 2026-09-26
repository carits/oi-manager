'use client'

import { useEffect, useState, useCallback } from 'react'
import collisionStyles from './TeamProblemListsTab.collision.module.css'
import unifiedStyles from './TeamProblemListsTab.unified.module.css'
import Link from 'next/link'
import { useAuth } from '@/features/auth'
import { usePathname } from 'next/navigation'
import type { ProblemListSummary, TeamProblemListItem } from '@oi-manager/contracts'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import { listProblemLists } from '@/features/problem'
import { addTeamProblemList, listTeamProblemLists, removeTeamProblemList } from '../api/teamApi'
import { Button } from '@/components/ui/Button'
import { FormDialog } from '@/components/ui/Dialogs'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

interface TeamProblemListsTabProps {
  teamId: string
  basePath: string
  canManage: boolean // owner/admin/teacher member
  isOwner: boolean
  userId?: string
}

export default function TeamProblemListsTab({ teamId, basePath, canManage, isOwner, userId }: TeamProblemListsTabProps) {
  const { user } = useAuth()
  const pathname = usePathname()
  const problemListsPrefix = currentWorkspacePrefix(pathname, '/personal/problem-lists', '/problem-lists')
  const isStudent = user?.organizationRole === 'student'
  const effectiveCanManage = canManage && !isStudent
  const toast = useToast()
  const [items, setItems] = useState<TeamProblemListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [myLists, setMyLists] = useState<ProblemListSummary[]>([])
  const [loadingMyLists, setLoadingMyLists] = useState(false)
  const [adding, setAdding] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<TeamProblemListItem | null>(null)

  const fetchItems = useCallback(async () => {
    try {
      setItems(await listTeamProblemLists(teamId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '团队题单加载失败')
    } finally {
      setLoading(false)
    }
  }, [teamId, toast])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const handleOpenAddModal = async () => {
    setShowAddModal(true)
    setLoadingMyLists(true)
    try {
      const result = await listProblemLists({ tab: 'mine', page: 1, pageSize: 100 })
      setMyLists(result.lists)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '我的题单加载失败')
    } finally {
      setLoadingMyLists(false)
    }
  }

  const alreadyAddedIds = new Set(items.map(i => i.problemListId))

  const handleAdd = async (problemListId: string) => {
    setAdding(true)
    try {
      const result = await addTeamProblemList(teamId, problemListId)
      if (!result.ok) {
        toast.error(result.error.message || '添加失败')
        return
      }
      toast.success('添加成功')
      setShowAddModal(false)
      await fetchItems()
    } catch (error) {
      toast.error('添加失败')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async () => {
    if (!removeTarget) return
    try {
      const result = await removeTeamProblemList(teamId, removeTarget.id)
      if (!result.ok) {
        toast.error(result.error.message || '移除失败')
        return
      }
      toast.success('已移除')
      setRemoveTarget(null)
      await fetchItems()
    } catch (error) {
      toast.error('移除失败')
    }
  }

  if (loading) {
    return <div className={unifiedStyles.u1}><span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></div>
  }

  return (
    <div>
      <div className={unifiedStyles.u2}>
        {effectiveCanManage && (
          <Button onClick={handleOpenAddModal}>+ 共享题单</Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className={unifiedStyles.u3}>
          <p>暂无题单</p>
          {effectiveCanManage && <p className={unifiedStyles.u4}>点击「共享题单」将你的题单共享给团队</p>}
        </div>
      ) : (
        <div className={unifiedStyles.u5}>
          {items.map(item => {
            const canRemove = !isStudent && (isOwner || item.addedBy === (userId || user?.userId))
            return (
              <div
                key={item.id}
                className={unifiedStyles.u6}
              >
                <div className={unifiedStyles.u7}>
                  <Link
                    href={`${problemListsPrefix}/${item.problemListId}`}
                    className={unifiedStyles.u8}
                  >
                    {item.problemList.title}
                  </Link>
                  {canRemove && (
                    <Button variant="ghost"
                      onClick={() => setRemoveTarget(item)}
                      className={unifiedStyles.u9}
                      title="移除"
                    >
                      ✕
                    </Button>
                  )}
                </div>
                {item.problemList.description && (
                  <p className={unifiedStyles.u10}>
                    {item.problemList.description}
                  </p>
                )}
                <div className={unifiedStyles.u11}>
                  <span>创建者: {item.problemList.ownerName}</span>
                  <span>添加者: {item.addedByName}</span>
                  <span>{item.problemList.entryCount} 题</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 添加题单弹窗 */}
      <FormDialog
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="共享题单给团队"
        size="lg"
      >
        <div className={unifiedStyles.u12}>
          {loadingMyLists ? (
            <div className={unifiedStyles.u13}><span className={[("resource-skeleton-line"), collisionStyles.u2].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></div>
          ) : myLists.length === 0 ? (
            <div className={unifiedStyles.u1}>
              <p>你还没有创建题单</p>
              <Link href={`${problemListsPrefix}/new`} className={unifiedStyles.u14}>去创建</Link>
            </div>
          ) : (
            <div className={unifiedStyles.u15}>
              {myLists.map(list => {
                const alreadyAdded = alreadyAddedIds.has(list.id)
                return (
                  <div key={list.id} className={`${unifiedStyles.problemListOption} ${alreadyAdded ? unifiedStyles.alreadyAdded : ''}`}>
                    <div>
                      <div className={unifiedStyles.u16}>{list.title}</div>
                      {list.description && (
                        <div className={unifiedStyles.u17}>{list.description}</div>
                      )}
                    </div>
                    {alreadyAdded ? (
                      <span className={unifiedStyles.u18}>已添加</span>
                    ) : (
                      <Button
                        onClick={() => handleAdd(list.id)}
                        disabled={adding}
                      >
                        {adding ? '添加中...' : '添加'}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </FormDialog>

      {/* 移除确认弹窗 */}
      <ConfirmModal
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        title="移除题单"
        message={`确定要从团队可见题单中移除「${removeTarget?.problemList?.title || ''}」吗？`}
        confirmText="移除"
        danger
      />
    </div>
  )
}
