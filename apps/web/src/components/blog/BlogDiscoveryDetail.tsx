'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import apiClient from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { BLOG_TYPE_LABELS, BLOG_VISIBILITY_LABELS, type BlogPostType, type BlogVisibility } from './blog-contract'
import styles from './BlogDiscovery.module.css'

type Post = { id: string; type: BlogPostType; visibility: BlogVisibility; publishedAt?: string | null; author: { username: string }; currentVersion: { title: string; summary?: string | null; version: number; contentMarkdown: string } | null }

export function BlogDiscoveryDetail({ id }: { id: string }) {
  const [post, setPost] = useState<Post | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    const result = await apiClient.get<Post>(`/api/blog-discovery/${encodeURIComponent(id)}`, { accountScoped: true })
    if (result.success && result.data) setPost(result.data)
    else setError(result.message || '文章加载失败')
  }, [id])
  useEffect(() => { void load() }, [load])
  if (error) return <main className={styles.detail}><div className={styles.error} role="alert">{error}<Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div><Link href="/blog">返回知识广场</Link></main>
  if (!post?.currentVersion) return <main className={styles.detail}>正在加载…</main>
  return <main className={styles.detail}>
    <nav><Link href="/blog">← 知识广场</Link></nav>
    <article><header><div className={styles.meta}><span>{BLOG_TYPE_LABELS[post.type]}</span><span>{BLOG_VISIBILITY_LABELS[post.visibility]}</span><span>V{post.currentVersion.version}</span></div><h1>{post.currentVersion.title}</h1>{post.currentVersion.summary && <p>{post.currentVersion.summary}</p>}<small>{post.author.username}{post.publishedAt ? ` · ${new Date(post.publishedAt).toLocaleString('zh-CN')}` : ''}</small></header><MarkdownRenderer content={post.currentVersion.contentMarkdown} securityProfile="knowledge" /></article>
  </main>
}
