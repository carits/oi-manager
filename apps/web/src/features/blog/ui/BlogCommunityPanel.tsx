'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bookmark, Flag, Heart, MessageCircle, ThumbsUp, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/FormControls'
import { useToast } from '@/components/ui/Toast'
import styles from './BlogWorkspace.module.css'
import { useAuth } from '@/features/auth'
import {
  createBlogComment,
  getBlogCommunity,
  listBlogComments,
  listBlogReplies,
  removeBlogComment,
  reportBlogContent,
  setBlogBookmark,
  setBlogReaction,
} from '../api/blogCommunityApi'

type Community = {
  reactions: { LIKE: number; HELPFUL: number }
  myReactions: string[]
  bookmarked: boolean
  commentCount: number
  featured?: { id: string; reason?: string | null } | null
}

type Comment = {
  id: string; parentId?: string | null; content: string; status: string; createdAt: string; canDelete: boolean
  author: { id: string; username: string; avatar?: string | null }; replies?: Comment[]; replyCount?: number
}

export function BlogCommunityPanel({ postId, publicRead = false }: { postId: string; publicRead?: boolean }) {
  const toast = useToast()
  const router = useRouter()
  const { isAuthenticated } = useAuth()
  const [community, setCommunity] = useState<Community | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [content, setContent] = useState('')
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingReplies, setLoadingReplies] = useState<Set<string>>(new Set())
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadFailure, setLoadFailure] = useState<{ userMessage: string; requestId?: string } | null>(null)

  const load = useCallback(async () => {
    setLoadState('loading')
    setLoadFailure(null)
    try {
      const [summary, commentPage] = await Promise.all([
        getBlogCommunity(postId, publicRead),
        listBlogComments(postId, publicRead),
      ])
      setCommunity(summary)
      setComments(commentPage.data)
      setLoadState('ready')
    } catch (loadFailure) {
      setLoadState('error')
      setLoadFailure({ userMessage: publicErrorMessage(loadFailure, '社区互动暂时无法加载') })
    }
  }, [postId, publicRead])

  const requireLogin = () => {
    if (isAuthenticated) return true
    const next = typeof window === 'undefined' ? `/blog/${postId}` : `${window.location.pathname}${window.location.search}`
    router.push(`/login?next=${encodeURIComponent(next)}`)
    return false
  }

  useEffect(() => { void load() }, [load])

  const react = async (type: 'LIKE' | 'HELPFUL') => {
    if (!requireLogin()) return
    if (!community) return
    const active = community.myReactions.includes(type)
    const result = await setBlogReaction(postId, type, !active)
    if (!result.ok) return toast.error(result.error.userMessage)
    setCommunity(result.data)
  }

  const bookmark = async () => {
    if (!requireLogin()) return
    if (!community) return
    const result = await setBlogBookmark(postId, !community.bookmarked)
    if (!result.ok) return toast.error(result.error.userMessage)
    setCommunity(result.data)
  }

  const submit = async () => {
    if (!requireLogin()) return
    if (!content.trim()) return
    setBusy(true)
    try {
      const result = await createBlogComment(postId, { content, parentId: replyTo?.id || null })
      if (!result.ok) return toast.error(result.error.userMessage)
      setContent(''); setReplyTo(null); await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    const result = await removeBlogComment(postId, id)
    if (!result.ok) return toast.error(result.error.userMessage)
    await load()
  }

  const report = async (commentId?: string) => {
    if (!requireLogin()) return
    const result = await reportBlogContent(postId, { reason: 'INAPPROPRIATE', commentId: commentId || null })
    result.ok ? toast.success('举报已提交，平台会进行复核') : toast.error(result.error.userMessage)
  }

  const loadMoreReplies = async (comment: Comment) => {
    if (loadingReplies.has(comment.id)) return
    setLoadingReplies(current => new Set(current).add(comment.id))
    const cursor = comment.replies?.at(-1)?.id
    try {
      const result = await listBlogReplies(postId, comment.id, publicRead, cursor)
      setComments(current => current.map(item => item.id === comment.id
        ? { ...item, replies: [...(item.replies || []), ...result.items.filter(reply => !(item.replies || []).some(existing => existing.id === reply.id))] }
        : item))
    } catch (replyError) {
      toast.error(publicErrorMessage(replyError, '加载回复失败'))
    } finally {
      setLoadingReplies(current => { const next = new Set(current); next.delete(comment.id); return next })
    }
  }

  const renderComment = (comment: Comment, reply = false) => <article className={reply ? styles.commentReply : styles.comment} key={comment.id}>
    <header><strong>{comment.author.username}</strong><time>{new Date(comment.createdAt).toLocaleString('zh-CN')}</time></header>
    <p>{comment.content}</p>
    {comment.status === 'visible' && <div className={styles.communityActions}>{!reply && <Button size="sm" variant="ghost" onClick={() => setReplyTo(comment)}>回复</Button>}<Button size="sm" variant="ghost" icon={<Flag size={14} />} onClick={() => void report(comment.id)}>举报</Button>{comment.canDelete && <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => void remove(comment.id)}>删除</Button>}</div>}
    {!reply && comment.replies?.map(item => renderComment(item, true))}
    {!reply && (comment.replies?.length || 0) < (comment.replyCount || 0) && <Button size="sm" variant="ghost" loading={loadingReplies.has(comment.id)} onClick={() => void loadMoreReplies(comment)}>加载更多回复（{(comment.replyCount || 0) - (comment.replies?.length || 0)}）</Button>}
  </article>

  if (loadState === 'loading') return <section className={styles.community} aria-busy="true" aria-labelledby="blog-community-title"><h2 id="blog-community-title">社区互动</h2><p className={styles.muted}>正在加载评论与互动…</p></section>
  if (loadState === 'error') return <section className={styles.community} aria-labelledby="blog-community-title"><h2 id="blog-community-title">社区互动</h2><div className={styles.error} role="alert"><span>{loadFailure?.userMessage || '社区互动暂时无法加载'}{loadFailure?.requestId && <details><summary>诊断信息</summary><code>请求编号：{loadFailure.requestId}</code></details>}</span><Button size="sm" variant="outline" onClick={() => void load()}>重试</Button></div></section>

  return <section className={styles.community} aria-labelledby="blog-community-title">
    <div className={styles.communityHead}><div><h2 id="blog-community-title">社区互动</h2>{community?.featured && <span className={styles.featured}>社区精选</span>}</div><div className={styles.communityActions}><Button size="sm" variant={community?.myReactions.includes('LIKE') ? 'primary' : 'secondary'} icon={<Heart size={15} />} onClick={() => void react('LIKE')}>喜欢 {community?.reactions.LIKE || 0}</Button><Button size="sm" variant={community?.myReactions.includes('HELPFUL') ? 'primary' : 'secondary'} icon={<ThumbsUp size={15} />} onClick={() => void react('HELPFUL')}>有帮助 {community?.reactions.HELPFUL || 0}</Button><Button size="sm" variant={community?.bookmarked ? 'primary' : 'secondary'} icon={<Bookmark size={15} />} onClick={() => void bookmark()}>{community?.bookmarked ? '已收藏' : '收藏'}</Button><Button size="sm" variant="ghost" icon={<Flag size={15} />} onClick={() => void report()}>举报文章</Button></div></div>
    <div className={styles.commentComposer}>{replyTo && <div className={styles.replying}>正在回复 {replyTo.author.username}<Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>取消</Button></div>}<Textarea rows={3} maxLength={5000} value={content} onChange={event => setContent(event.target.value)} placeholder={isAuthenticated ? '理性讨论，补充解法或指出问题……' : '登录后参与讨论'} onFocus={() => { if (!isAuthenticated) requireLogin() }} /><div><span><MessageCircle size={15} /> {community?.commentCount || 0} 条评论</span><Button loading={busy} disabled={isAuthenticated && !content.trim()} onClick={() => void submit()}>{isAuthenticated ? '发表评论' : '登录后评论'}</Button></div></div>
    <div className={styles.comments}>{comments.length ? comments.map(item => renderComment(item)) : <p className={styles.muted}>还没有评论，来分享你的思路吧。</p>}</div>
  </section>
}
