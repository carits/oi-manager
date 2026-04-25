'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useToast } from '@/components/ui/Toast'

interface ProblemListInfo {
  id: string
  title: string
  description: string | null
  ownerId: string
  createdAt: string
  updatedAt: string
  _count: { Entries: number }
  _permission: 'admin' | 'edit' | 'view'
}

export interface ProblemListPageProps {
  /** 是否显示新建按钮 */
  canCreate?: boolean
  /** 显示模式: table(教师端) | card(学生端) */
  displayMode?: 'table' | 'card'
}

export default function ProblemListPage({ canCreate = true, displayMode = 'table' }: ProblemListPageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const pathPrefix = user?.role === 'student' ? '/student' : '/teacher'

  const [activeTab, setActiveTab] = useState<'mine' | 'shared'>(
    (searchParams.get('tab') as 'mine' | 'shared') || 'mine'
  )
  const [lists, setLists] = useState<ProblemListInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const toast = useToast()

  const fetchLists = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ tab: activeTab, pageSize: '50' })
      if (searchInput) params.set('keyword', searchInput)
      else params.delete('keyword')
      const res = await apiClient.get(`/api/problem-lists?${params}`)
      if (res.success && res.data) {
        setLists(((res.data) as any).lists || [])
      }
    } catch (e) {
      console.error('Failed to fetch lists', e)
      if (canCreate) toast.error('获取题单列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchLists() }, [activeTab, searchInput])

  useEffect(() => {
    const tab = searchParams.get('tab') as 'mine' | 'shared'
    if (tab === 'mine' || tab === 'shared') setActiveTab(tab)
  }, [searchParams])

  const handleDelete = async (id: string) => {
    try {
      const res = await apiClient.delete(`/api/problem-lists/${id}`)
      if (res.success) {
        toast.success('删除成功')
        fetchLists()
      } else {
        toast.error(res.message || '删除失败')
      }
    } catch {
      toast.error('删除失败')
    }
    setDeleteConfirm(null)
  }

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMins / 60)
      const diffDays = Math.floor(diffHours / 24)
      if (diffDays > 0) return `${diffDays} 天前`
      if (diffHours > 0) return `${diffHours} 小时前`
      if (diffMins > 0) return `${diffMins} 分钟前`
      return '刚刚'
    } catch {
      return dateStr
    }
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
      {/* 页面标题 + 操作 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>题单</h1>
        {canCreate && (
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchLists()}
              placeholder="搜索题单"
              style={{
                padding: '0.5rem 0.75rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '0.875rem',
                width: '200px',
              }}
            />
            <button
              onClick={() => fetchLists()}
              style={{
                padding: '0.5rem 1rem',
                background: 'transparent',
                color: 'var(--gray-500)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              搜索
            </button>
            <button
              onClick={() => router.push(`${pathPrefix}/problem-lists/new`)}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              + 新建题单
            </button>
          </div>
        )}
      </div>

      {/* Sub-tab: 我的题单 / 共享题单 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
        {[
          { key: 'mine' as const, label: '我的题单' },
          { key: 'shared' as const, label: '共享题单' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); router.push(`${pathPrefix}/problem-lists?tab=${tab.key}`, { scroll: false }) }}
            style={{
              padding: '0.75rem 1rem',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.875rem',
              color: activeTab === tab.key ? 'var(--primary)' : 'var(--gray-500)',
              fontWeight: activeTab === tab.key ? 600 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>加载中...</div>
      ) : lists.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          background: 'white',
          borderRadius: '8px',
          border: '1px solid var(--border)',
        }}>
          <h3 style={{ marginBottom: '0.5rem' }}>
            {activeTab === 'mine' ? '暂无题单' : '暂无共享题单'}
          </h3>
          <p style={{ color: 'var(--gray-500)', marginBottom: '1rem' }}>
            {activeTab === 'mine' ? '点击"新建题单"创建您的第一个题单' : '没有题单被分享给您'}
          </p>
          {activeTab === 'mine' && canCreate && (
            <button
              onClick={() => router.push(`${pathPrefix}/problem-lists/new`)}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              新建题单
            </button>
          )}
        </div>
      ) : displayMode === 'card' ? (
        /* 卡片模式（学生端） */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr)', gap: '1rem' }}>
          {lists.map(list => (
            <div
              key={list.id}
              style={{
                background: 'white',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                padding: '1.25rem',
                cursor: 'pointer',
                position: 'relative',
              }}
              onClick={() => router.push(`${pathPrefix}/problem-lists/${list.id}`)}
            >
              <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>{list.title}</h3>
              {list.description && (
                <p style={{ color: 'var(--gray-500)', fontSize: '0.8rem', marginBottom: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {list.description}
                </p>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                  {list._count?.Entries ?? 0} 题
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                  {formatDate(list.updatedAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* 表格模式（教师端） */
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.8rem', color: 'var(--gray-500)', fontWeight: 500 }}>标题</th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.8rem', color: 'var(--gray-500)', fontWeight: 500, width: '200px' }}>描述</th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--gray-500)', fontWeight: 500, width: '80px' }}>题目数</th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--gray-500)', fontWeight: 500, width: '100px' }}>更新时间</th>
              <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--gray-500)', fontWeight: 500, width: '120px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {lists.map(list => (
              <tr
                key={list.id}
                style={{ borderBottom: '1px solid var(--gray-100)' }}
              >
                <td style={{ padding: '0.75rem 1rem' }}>
                  <span
                    onClick={() => router.push(`${pathPrefix}/problem-lists/${list.id}`)}
                    style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--primary)', cursor: 'pointer' }}
                  >
                    {list.title}
                  </span>
                </td>
                <td style={{ padding: '0.75rem 1rem', fontSize: '0.8rem', color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                  {list.description || '-'}
                </td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.85rem' }}>
                  {list._count?.Entries ?? 1} 题
                </td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--gray-500)' }}>
                  {formatDate(list.updatedAt)}
                </td>
                <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'row', gap: '0.5rem', justifyContent: 'center' }}>
                    {(list._permission === 'admin' || list._permission === 'edit') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); router.push(`${pathPrefix}/problem-lists/${list.id}`) }}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        编辑
                      </button>
                    )}
                    {list._permission === 'admin' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(list.id) }}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', color: 'var(--error)' }}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        title="确认删除" message="确定要删除此题单?？此操作不可撤销。" confirmText="删除" danger
 loading={false}
      />
    </div>
  )
}
