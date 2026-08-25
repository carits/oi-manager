'use client'

import { useState } from 'react'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import { useResource } from '@/hooks/useResource'
import apiClient from '@/lib/apiClient'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { Button } from '@/components/ui/Button'
import { ActionMenu, ActionMenuItem } from '@/components/management/ManagementList'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Table } from '@/components/ui/Table'
import { Tabs } from '@/components/ui/Tabs'
import { Toolbar, ToolbarGroup } from '@/components/ui/Toolbar'
import { useToast } from '@/components/ui/Toast'
import styles from './ProblemList.module.css'

interface ProblemListInfo { id: string; title: string; description: string | null; ownerId: string; createdAt: string; updatedAt: string; _count: { Entries: number }; _permission: 'admin' | 'edit' | 'view' }
interface ProblemListPayload { lists?: ProblemListInfo[] }
export interface ProblemListPageProps { canCreate?: boolean; displayMode?: 'table' | 'card' }

function formatDate(dateString: string) {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - new Date(dateString).getTime()) / 60000))
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)} 小时前`
  return `${Math.floor(diffMinutes / 1440)} 天前`
}

export default function ProblemListPage({ canCreate = true, displayMode = 'table' }: ProblemListPageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, sessionKey } = useAuth()
  const pathname = usePathname()
  const toast = useToast()
  const pathPrefix = currentWorkspacePrefix(pathname, user?.role === 'platform_admin' ? '/platform-admin' : '/personal')
  const activeTab: 'mine' | 'shared' = searchParams.get('tab') === 'shared' ? 'shared' : 'mine'
  const keyword = searchParams.get('keyword') || ''
  const [searchInput, setSearchInput] = useState(keyword)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const query = new URLSearchParams({ tab: activeTab, pageSize: '50' })
  if (keyword) query.set('keyword', keyword)
  const resource = useResource<ProblemListPayload>(`/api/problem-lists?${query}`, { sessionKey, isEmpty: data => (data.lists || []).length === 0, dedupingInterval: 15000 })
  const lists = resource.data?.lists || []

  const updateLocation = (tab: 'mine' | 'shared', nextKeyword = keyword) => {
    const params = new URLSearchParams()
    if (tab === 'shared') params.set('tab', tab)
    if (nextKeyword.trim()) params.set('keyword', nextKeyword.trim())
    router.replace(`${pathPrefix}/problem-lists${params.size ? `?${params}` : ''}`, { scroll: false })
  }

  const deleteList = async (id: string) => {
    const result = await apiClient.delete(`/api/problem-lists/${id}`)
    setDeleteConfirm(null)
    if (!result.success) return toast.error(result.message || '删除失败')
    toast.success('题单已删除')
    await resource.retry()
  }

  const newAction = canCreate ? <Button icon={<Plus size={17} />} onClick={() => router.push(`${pathPrefix}/problem-lists/new`)}>新建题单</Button> : undefined

  return (
    <PageFrame>
      <PageHeader title="题单" description="集中组织题目，并按需要共享或发布。" actions={newAction} />
      <Toolbar>
        <ToolbarGroup>
          <Input className={styles.search} value={searchInput} onChange={event => setSearchInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') updateLocation(activeTab, searchInput) }} placeholder="按名称搜索题单" aria-label="搜索题单" />
          <Button variant="secondary" icon={<Search size={16} />} onClick={() => updateLocation(activeTab, searchInput)}>搜索</Button>
        </ToolbarGroup>
        {keyword && <Button variant="text" onClick={() => { setSearchInput(''); updateLocation(activeTab, '') }}>清除搜索</Button>}
      </Toolbar>
      <Tabs label="题单范围" value={activeTab} onChange={tab => updateLocation(tab)} items={[{ value: 'mine', label: '我的题单' }, { value: 'shared', label: '共享给我' }]} />
      <AsyncRegion state={resource.state} onRetry={resource.retry} emptyText={activeTab === 'mine' ? '暂无题单' : '暂无共享题单'} skeletonRows={6}>
        {(_, refreshing) => displayMode === 'card' ? (
          <div className={styles.cardGrid} aria-busy={refreshing || undefined}>
            {lists.map(list => <Link key={list.id} className={styles.listCard} href={`${pathPrefix}/problem-lists/${list.id}`}><h2 className={styles.listTitle}>{list.title}</h2><p className={styles.listDescription}>{list.description || '暂无题单说明'}</p><div className={styles.listMeta}><span>{list._count?.Entries ?? 0} 题</span><span>{formatDate(list.updatedAt)}</span></div></Link>)}
          </div>
        ) : (
          <Table
            data={lists}
            refreshing={refreshing}
            rowKey={list => list.id}
            emptyText="暂无题单"
            columns={[
              { key: 'title', label: '标题', render: list => <Link className={styles.titleLink} href={`${pathPrefix}/problem-lists/${list.id}`}>{list.title}</Link> },
              { key: 'description', label: '描述', render: list => list.description || '—' },
              { key: 'count', label: '题目数', align: 'center', width: '96px', render: list => list._count?.Entries ?? 0 },
              { key: 'updatedAt', label: '更新时间', width: '120px', render: list => formatDate(list.updatedAt) },
            ]}
            actions={list => <>{(list._permission === 'admin' || list._permission === 'edit') && <Button size="sm" variant="text" onClick={() => router.push(`${pathPrefix}/problem-lists/${list.id}`)}>编辑</Button>}{list._permission === 'admin' && <ActionMenu><ActionMenuItem danger onClick={() => setDeleteConfirm(list.id)}>删除题单</ActionMenuItem></ActionMenu>}</>}
          />
        )}
      </AsyncRegion>
      <ConfirmModal isOpen={Boolean(deleteConfirm)} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm) void deleteList(deleteConfirm) }} title="删除题单" message="删除后无法恢复，确定继续吗？" confirmText="删除" danger />
    </PageFrame>
  )
}
