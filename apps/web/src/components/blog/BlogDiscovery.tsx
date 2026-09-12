'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { BookOpenText, Search } from 'lucide-react'
import apiClient from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/FormControls'
import { EmptyState } from '@/components/ui/EmptyState'
import { Pagination } from '@/components/ui/Pagination'
import { BLOG_TYPE_LABELS, BLOG_VISIBILITY_LABELS, type BlogPostType, type BlogVisibility } from './blog-contract'
import styles from './BlogDiscovery.module.css'
import { useAuth } from '@/components/AuthProvider'
import { isGlobalAdministrator } from '@/lib/capabilities'

type DiscoveryPost = {
  id: string
  slug: string
  type: BlogPostType
  visibility: BlogVisibility
  publishedAt?: string | null
  author: { username: string; avatar?: string | null }
  currentVersion: { title: string; summary?: string | null; version: number; classification?: { tags?: Array<{ id: string; name: string }> } } | null
}
type Payload = { items: DiscoveryPost[]; page: number; pageSize: number; total: number; totalPages: number }

export function BlogDiscovery({ workspaceBasePath = '/blog', embedded = false }: { workspaceBasePath?: string; embedded?: boolean }) {
  const { user, isAuthenticated } = useAuth()
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const params = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (submittedQuery) params.set('q', submittedQuery)
    if (type) params.set('type', type)
    const result = await apiClient.get<Payload>(`/api/blog-discovery?${params}`, { accountScoped: true })
    if (result.success && result.data) setPayload(result.data)
    else { setPayload(null); setError(result.message || '知识广场加载失败') }
    setLoading(false)
  }, [page, submittedQuery, type])

  useEffect(() => { void load() }, [load])

  const isGlobalAdmin = isGlobalAdministrator(user?.role)
  const managementHref = user?.accountRole === 'super_admin' ? '/admin' : '/platform-admin'
  return <main className={`${styles.page} ${embedded ? styles.embedded : ''}`}>
    <header className={styles.header}><div>{!embedded && <Link href="/" className={styles.brand}>Carits</Link>}<h1>知识广场</h1><p>浏览作者公开发布的题解、训练复盘和竞赛经验。</p></div>{isAuthenticated && !isGlobalAdmin ? <Link href="/personal/blogs" className={styles.authorLink}>我的文章</Link> : isAuthenticated && isGlobalAdmin ? <Link href={managementHref} className={styles.authorLink}>管理工作台</Link> : <Link href={`/login?next=${encodeURIComponent(workspaceBasePath)}`} className={styles.authorLink}>登录</Link>}</header>
    <form className={styles.toolbar} onSubmit={event => { event.preventDefault(); setPage(1); setSubmittedQuery(query.trim()) }}>
      <Input aria-label="搜索知识文章" placeholder="搜索标题、摘要或作者" value={query} onChange={event => setQuery(event.target.value)} />
      <Select aria-label="文章类型" value={type} onChange={event => { setType(event.target.value); setPage(1) }}><option value="">全部类型</option>{Object.entries(BLOG_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
      <Button type="submit" icon={<Search size={16} />}>搜索</Button>
    </form>
    {error && <div className={styles.error} role="alert">{error}<Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div>}
    {!loading && !error && !payload?.items.length ? <EmptyState icon={<BookOpenText size={32} />} title="暂时没有可见文章" description="登录后还可以浏览平台用户可见的知识文章。" /> : <section className={styles.grid} aria-busy={loading}>{payload?.items.map(post => <Link href={`${workspaceBasePath}/${post.slug || post.id}`} key={post.id} className={styles.card}>
      <div className={styles.meta}><span>{BLOG_TYPE_LABELS[post.type]}</span><span>{BLOG_VISIBILITY_LABELS[post.visibility]}</span></div>
      <h2>{post.currentVersion?.title || '未命名文章'}</h2>
      {post.currentVersion?.summary && <p>{post.currentVersion.summary}</p>}
      <footer><span>{post.author.username}</span><time>{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('zh-CN') : ''}</time></footer>
    </Link>)}</section>}
    {payload && payload.totalPages > 1 && <Pagination currentPage={payload.page} totalPages={payload.totalPages} total={payload.total} pageSize={payload.pageSize} onPageChange={setPage} />}
  </main>
}
