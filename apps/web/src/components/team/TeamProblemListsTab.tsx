'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'

interface ProblemListInfo {
  id: string
  title: string
  description: string | null
  ownerId: string
  ownerName: string
  ownerType: string
  sectionCount: number
  entryCount: number
}

interface TeamProblemListItem {
  id: string
  problemListId: string
  addedBy: string
  addedByName: string
  addedByRole: string
  sortOrder: number
  createdAt: string
  problemList: ProblemListInfo
}

interface MyProblemList {
  id: string
  title: string
  description: string | null
}

interface TeamProblemListsTabProps {
  teamId: string
  basePath: string
  canManage: boolean // owner/admin/teacher member
  isOwner: boolean
  userId?: string
}

export default function TeamProblemListsTab({ teamId, basePath, canManage, isOwner, userId }: TeamProblemListsTabProps) {
  const { user } = useAuth()
  const isStudent = user?.role === 'student'
  const effectiveCanManage = canManage && !isStudent
  const toast = useToast()
  const [items, setItems] = useState<TeamProblemListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [myLists, setMyLists] = useState<MyProblemList[]>([])
  const [loadingMyLists, setLoadingMyLists] = useState(false)
  const [adding, setAdding] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<TeamProblemListItem | null>(null)

  const fetchItems = useCallback(async () => {
    try {
      const result = await apiClient.get<TeamProblemListItem[]>(`/api/teams/${teamId}/problem-lists`)
      if (result.success) {
        setItems(result.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch team problem lists:', error)
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  const handleOpenAddModal = async () => {
    setShowAddModal(true)
    setLoadingMyLists(true)
    try {
      const result = await apiClient.get<any>('/api/problem-lists?tab=mine')
      if (result.success) {
        setMyLists(result.data?.lists || [])
      }
    } catch (error) {
      console.error('Failed to fetch my problem lists:', error)
    } finally {
      setLoadingMyLists(false)
    }
  }

  const alreadyAddedIds = new Set(items.map(i => i.problemListId))

  const handleAdd = async (problemListId: string) => {
    setAdding(true)
    try {
      const result = await apiClient.post(`/api/teams/${teamId}/problem-lists`, { problemListId })
      if (result.success) {
        toast.success('添加成功')
        setShowAddModal(false)
        fetchItems()
      } else {
        toast.error(result.message || '添加失败')
      }
    } catch (error) {
      toast.error('添加失败')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async () => {
    if (!removeTarget) return
    try {
      const result = await apiClient.delete(`/api/teams/${teamId}/problem-lists/${removeTarget.id}`)
      if (result.success) {
        toast.success('已移除')
        setRemoveTarget(null)
        fetchItems()
      } else {
        toast.error(result.message || '移除失败')
      }
    } catch (error) {
      toast.error('移除失败')
    }
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}><span className="resource-skeleton-line" style={{ display: 'inline-block', width: '8rem' }} aria-label="内容正在准备" /></div>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1rem' }}>
        {effectiveCanManage && (
          <Button onClick={handleOpenAddModal}>+ 共享题单</Button>
        )}
      </div>

      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>
          <p>暂无题单</p>
          {effectiveCanManage && <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>点击「共享题单」将你的题单共享给团队</p>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {items.map(item => {
            const canRemove = !isStudent && (isOwner || item.addedBy === (userId || user?.userId))
            const pathPrefix = isStudent ? '/student/problem-lists' : '/teacher/problem-lists'
            return (
              <div
                key={item.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '1rem',
                  background: 'white',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Link
                    href={`${pathPrefix}/${item.problemListId}`}
                    style={{ fontWeight: 600, color: 'var(--primary)', textDecoration: 'none', fontSize: '0.95rem' }}
                  >
                    {item.problemList.title}
                  </Link>
                  {canRemove && (
                    <button
                      onClick={() => setRemoveTarget(item)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--gray-400)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        padding: '0.2rem 0.4rem',
                      }}
                      title="移除"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {item.problemList.description && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--gray-500)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.problemList.description}
                  </p>
                )}
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: 'auto' }}>
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
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="共享题单给团队"
        width="600px"
      >
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {loadingMyLists ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}><span className="resource-skeleton-line" style={{ display: 'inline-block', width: '8rem' }} aria-label="内容正在准备" /></div>
          ) : myLists.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
              <p>你还没有创建题单</p>
              <Link href="/teacher/problem-lists/new" style={{ color: 'var(--primary)' }}>去创建</Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {myLists.map(list => {
                const alreadyAdded = alreadyAddedIds.has(list.id)
                return (
                  <div
                    key={list.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.75rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      opacity: alreadyAdded ? 0.5 : 1,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500 }}>{list.title}</div>
                      {list.description && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>{list.description}</div>
                      )}
                    </div>
                    {alreadyAdded ? (
                      <span style={{ fontSize: '0.8rem', color: 'var(--gray-400)' }}>已添加</span>
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
      </Modal>

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
