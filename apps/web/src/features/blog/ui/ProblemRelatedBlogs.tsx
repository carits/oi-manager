'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, BookOpenText, PenLine } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/Badge'
import type { ProblemRelatedBlog } from '@oi-manager/contracts'
import { BLOG_TYPE_LABELS } from '../model/blog-contract'
import { listProblemRelatedBlogs } from '../api/blogDiscoveryApi'
import styles from './ProblemRelatedBlogs.module.css'

export function ProblemRelatedBlogs({ problemId }: { problemId: string }) {
  const router = useRouter()
  const [items, setItems] = useState<ProblemRelatedBlog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setItems((await listProblemRelatedBlogs(problemId)).items)
    } catch (loadError) {
      setItems([])
      setError(publicErrorMessage(loadError, '关联文章加载失败'))
    } finally {
      setLoading(false)
    }
  }, [problemId])
  useEffect(() => { void load() }, [load])

  return <section className={styles.root}>
    <header><div><h2>关联知识文章</h2><p>这里只展示通过结构化引用关联、且当前账号可见的已发布文章。</p></div><Button icon={<PenLine size={16} />} onClick={() => router.push(`/personal/blogs/new?problemId=${encodeURIComponent(problemId)}`)}>写关联文章</Button></header>
    {error && <div className={styles.error} role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>重试</Button></div>}
    {loading ? <p className={styles.loading}>正在加载关联文章…</p> : !error && items.length === 0 ? <EmptyState icon={<BookOpenText size={30} />} title="暂无关联文章" description="博客与官方题解相互独立；发布博客不会直接成为正式题解。" /> : <div className={styles.list}>{items.map(item => <Link key={item.id} href={`/personal/blogs/${item.id}`}>
      <div><StatusBadge variant="info">{BLOG_TYPE_LABELS[item.type]}</StatusBadge><span>V{item.currentVersion.version}</span></div>
      <strong>{item.currentVersion.title}</strong>{item.currentVersion.summary && <p>{item.currentVersion.summary}</p>}
      <small>作者：{item.author.username} · {new Date(item.currentVersion.publishedAt).toLocaleString('zh-CN')}</small><ArrowRight size={17} aria-hidden="true" />
    </Link>)}</div>}
  </section>
}
