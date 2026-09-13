'use client'

import { useCallback, useEffect, useState } from 'react'
import { BookOpenText, Library, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/FormControls'
import { StatusBadge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import apiClient from '@/lib/apiClient'
import { BLOG_TYPE_LABELS, BLOG_VISIBILITY_LABELS, type BlogPostType, type BlogVisibility } from '../model/blog-contract'
import styles from './BlogWorkspace.module.css'

type BlogListItem = {
  id: string
  type: BlogPostType
  status: string
  visibility: BlogVisibility
  updatedAt: string
  publishedAt?: string | null
  currentVersion?: { version: number; title: string; summary?: string | null; classification?: { series?: { title: string } | null; tags?: Array<{ id: string; name: string }> } } | null
  draft?: { title: string; summary?: string | null; revision: number } | null
}

type BlogListPayload = { items: BlogListItem[]; page: number; pageSize: number; total: number; totalPages: number }

function statusBadge(status: string) {
  if (status === 'PUBLISHED') return <StatusBadge variant="success">已发布</StatusBadge>
  if (status === 'ARCHIVED') return <StatusBadge variant="neutral">已归档</StatusBadge>
  if (status === 'MODERATION_HOLD') return <StatusBadge variant="warning">审核保留</StatusBadge>
  if (status === 'REMOVED') return <StatusBadge variant="error">已移除</StatusBadge>
  return <StatusBadge variant="pending">草稿</StatusBadge>
}

export function BlogListPage() {
  const router = useRouter()
  const [items, setItems] = useState<BlogListItem[]>([])
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [payload, setPayload] = useState<BlogListPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const query = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (status) query.set('status', status)
    const result = await apiClient.get<BlogListPayload>(`/api/blogs?${query}`, { accountScoped: true })
    if (result.success && result.data) { setItems(result.data.items); setPayload(result.data) }
    else { setItems([]); setPayload(null); setError(result.message || '博客列表加载失败') }
    setLoading(false)
  }, [page, status])

  useEffect(() => { void load() }, [load])

  return <PageFrame width="reading"><div className={styles.stack}>
    <PageHeader title="知识文章" description="以不可变版本发布 Markdown、LaTeX 与代码；结构化引用在发布时固定。" actions={<><Button variant="outline" icon={<Library size={16} />} onClick={() => router.push('/personal/blogs/series')}>管理系列</Button><Button icon={<Plus size={16} />} onClick={() => router.push('/personal/blogs/new')}>新建文章</Button></>} />
    <div className={styles.toolbar}>
      <Select aria-label="文章状态" value={status} onChange={event => { setStatus(event.target.value); setPage(1) }}><option value="">全部状态</option><option value="DRAFT">草稿</option><option value="PUBLISHED">已发布</option><option value="ARCHIVED">已归档</option></Select>
      <Button variant="outline" loading={loading} onClick={() => void load()}>刷新</Button>
    </div>
    {error && <div className={styles.error} role="alert"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div>}
    {!loading && !error && items.length === 0 ? <EmptyState icon={<BookOpenText size={32} />} title="还没有知识文章" description="创建草稿后，可选择公开、组织可见、不公开列出或仅自己。" action={<Button onClick={() => router.push('/personal/blogs/new')}>新建第一篇</Button>} /> : <div className={styles.blogGrid}>{items.map(item => {
      const title = item.draft?.title || item.currentVersion?.title || '未命名文章'
      const summary = item.draft?.summary || item.currentVersion?.summary
      return <Link className={styles.blogCard} key={item.id} href={`/personal/blogs/${item.id}`}>
        <div className={styles.cardTop}><span>{BLOG_TYPE_LABELS[item.type]}</span>{statusBadge(item.status)}</div>
        <h2>{title}</h2>{summary && <p>{summary}</p>}
        {(item.currentVersion?.classification?.series || item.currentVersion?.classification?.tags?.length) && <div className={styles.classificationSummary}>{item.currentVersion.classification.series && <span>系列：{item.currentVersion.classification.series.title}</span>}{item.currentVersion.classification.tags?.map(tag => <StatusBadge key={tag.id} variant="neutral">{tag.name}</StatusBadge>)}</div>}
        <div className={styles.cardMeta}><span>{BLOG_VISIBILITY_LABELS[item.visibility]}</span><span>{item.currentVersion ? `V${item.currentVersion.version}` : `草稿 R${item.draft?.revision || 1}`}</span><time>{new Date(item.updatedAt).toLocaleString('zh-CN')}</time></div>
      </Link>
    })}</div>}
    {payload && payload.totalPages > 1 && <Pagination currentPage={payload.page} totalPages={payload.totalPages} total={payload.total} pageSize={payload.pageSize} onPageChange={setPage} />}
  </div></PageFrame>
}
