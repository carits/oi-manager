'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { BLOG_TYPE_LABELS, BLOG_VISIBILITY_LABELS, type BlogClassificationSnapshot, type BlogPostType, type BlogVisibility } from '../model/blog-contract'
import { BlogClassificationView, BlogReferenceCards, type PublishedBlogReference } from './BlogPublishedMetadata'
import { BlogCommunityPanel } from './BlogCommunityPanel'
import styles from './BlogDiscovery.module.css'
import { getBlogDiscovery } from '@/features/blog/api/blogDiscoveryApi'
import type { BlogDiscoveryDetail as BlogDiscoveryDetailContract } from '@oi-manager/contracts'

export function BlogDiscoveryDetail({ id, workspaceBasePath = '/blog', embedded = false }: { id: string; workspaceBasePath?: string; embedded?: boolean }) {
  const [post, setPost] = useState<BlogDiscoveryDetailContract | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      setPost(await getBlogDiscovery(id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '文章加载失败')
    }
  }, [id])
  useEffect(() => { void load() }, [load])
  if (error) return <main className={`${styles.detail} ${embedded ? styles.embedded : ''}`}><div className={styles.error} role="alert">{error}<Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div><Link href={workspaceBasePath}>返回知识广场</Link></main>
  if (!post?.currentVersion) return <main className={`${styles.detail} ${embedded ? styles.embedded : ''}`}>正在加载…</main>
  return <main className={`${styles.detail} ${embedded ? styles.embedded : ''}`}>
    <nav><Link href={workspaceBasePath}>← 知识广场</Link></nav>
    <article>
      <header>
        <div className={styles.meta}><span>{BLOG_TYPE_LABELS[post.type]}</span><span>{BLOG_VISIBILITY_LABELS[post.visibility]}</span><span>V{post.currentVersion.version}</span></div>
        <h1>{post.currentVersion.title}</h1>
        {post.currentVersion.summary && <p>{post.currentVersion.summary}</p>}
        <small>{post.author.username}{post.publishedAt ? ` · ${new Date(post.publishedAt).toLocaleString('zh-CN')}` : ''}</small>
        <BlogClassificationView classification={post.currentVersion.classification} />
      </header>
      <MarkdownRenderer content={post.currentVersion.contentMarkdown} securityProfile="knowledge" />
      {post.currentVersion.references.length > 0 && <section className={styles.references}><h2>固定引用</h2><BlogReferenceCards references={post.currentVersion.references} publicRead={!embedded} /></section>}
      {post.seriesNavigation && <nav className={styles.seriesNav} aria-label="系列文章导航">
        <div><strong>{post.seriesNavigation.title}</strong><span>第 {post.seriesNavigation.index}/{post.seriesNavigation.total} 篇</span></div>
        <div>
          {post.seriesNavigation.previous ? <Link href={`${workspaceBasePath}/${post.seriesNavigation.previous.slug || post.seriesNavigation.previous.id}`}>← {post.seriesNavigation.previous.title}</Link> : <span />}
          {post.seriesNavigation.next && <Link href={`${workspaceBasePath}/${post.seriesNavigation.next.slug || post.seriesNavigation.next.id}`}>{post.seriesNavigation.next.title} →</Link>}
        </div>
      </nav>}
      <BlogCommunityPanel postId={post.id} publicRead />
    </article>
  </main>
}
