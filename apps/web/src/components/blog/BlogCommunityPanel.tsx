'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bookmark, Flag, Heart, MessageCircle, ThumbsUp, Trash2 } from 'lucide-react'
import apiClient from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/FormControls'
import { useToast } from '@/components/ui/Toast'
import styles from './BlogWorkspace.module.css'

type Community = {
  reactions: { LIKE: number; HELPFUL: number }
  myReactions: string[]
  bookmarked: boolean
  commentCount: number
  featured?: { id: string; reason?: string | null } | null
}

type Comment = {
  id: string; parentId?: string | null; content: string; status: string; createdAt: string; canDelete: boolean
  author: { id: string; username: string; avatar?: string | null }; replies?: Comment[]
}

type CommentPage = { data: Comment[]; total: number }

export function BlogCommunityPanel({ postId }: { postId: string }) {
  const toast = useToast()
  const [community, setCommunity] = useState<Community | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [content, setContent] = useState('')
  const [replyTo, setReplyTo] = useState<Comment | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [summary, commentPage] = await Promise.all([
      apiClient.get<Community>(`/api/blogs/${postId}/community`, { accountScoped: true }),
      apiClient.get<CommentPage>(`/api/blogs/${postId}/comments?pageSize=100`, { accountScoped: true }),
    ])
    if (summary.success && summary.data) setCommunity(summary.data)
    if (commentPage.success && commentPage.data) setComments(commentPage.data.data)
  }, [postId])

  useEffect(() => { void load() }, [load])

  const react = async (type: 'LIKE' | 'HELPFUL') => {
    if (!community) return
    const active = community.myReactions.includes(type)
    const result = active
      ? await apiClient.delete<Community>(`/api/blogs/${postId}/reactions/${type}`, { accountScoped: true })
      : await apiClient.put<Community>(`/api/blogs/${postId}/reactions/${type}`, {}, { accountScoped: true })
    if (!result.success || !result.data) return toast.error(result.message || '操作失败')
    setCommunity(result.data)
  }

  const bookmark = async () => {
    if (!community) return
    const result = community.bookmarked
      ? await apiClient.delete<Community>(`/api/blogs/${postId}/bookmark`, { accountScoped: true })
      : await apiClient.put<Community>(`/api/blogs/${postId}/bookmark`, {}, { accountScoped: true })
    if (!result.success || !result.data) return toast.error(result.message || '操作失败')
    setCommunity(result.data)
  }

  const submit = async () => {
    if (!content.trim()) return
    setBusy(true)
    const result = await apiClient.post(`/api/blogs/${postId}/comments`, { content, parentId: replyTo?.id || null }, { accountScoped: true })
    setBusy(false)
    if (!result.success) return toast.error(result.message || '评论失败')
    setContent(''); setReplyTo(null); await load()
  }

  const remove = async (id: string) => {
    const result = await apiClient.delete(`/api/blogs/${postId}/comments/${id}`, { accountScoped: true })
    if (!result.success) return toast.error(result.message || '删除评论失败')
    await load()
  }

  const report = async (commentId?: string) => {
    const result = await apiClient.post(`/api/blogs/${postId}/reports`, { reason: 'INAPPROPRIATE', commentId: commentId || null }, { accountScoped: true })
    result.success ? toast.success('举报已提交，平台会进行复核') : toast.error(result.message || '举报失败')
  }

  const renderComment = (comment: Comment, reply = false) => <article className={reply ? styles.commentReply : styles.comment} key={comment.id}>
    <header><strong>{comment.author.username}</strong><time>{new Date(comment.createdAt).toLocaleString('zh-CN')}</time></header>
    <p>{comment.content}</p>
    {comment.status === 'visible' && <div className={styles.communityActions}>{!reply && <Button size="sm" variant="ghost" onClick={() => setReplyTo(comment)}>回复</Button>}<Button size="sm" variant="ghost" icon={<Flag size={14} />} onClick={() => void report(comment.id)}>举报</Button>{comment.canDelete && <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => void remove(comment.id)}>删除</Button>}</div>}
    {!reply && comment.replies?.map(item => renderComment(item, true))}
  </article>

  return <section className={styles.community} aria-labelledby="blog-community-title">
    <div className={styles.communityHead}><div><h2 id="blog-community-title">社区互动</h2>{community?.featured && <span className={styles.featured}>社区精选</span>}</div><div className={styles.communityActions}><Button size="sm" variant={community?.myReactions.includes('LIKE') ? 'primary' : 'secondary'} icon={<Heart size={15} />} onClick={() => void react('LIKE')}>喜欢 {community?.reactions.LIKE || 0}</Button><Button size="sm" variant={community?.myReactions.includes('HELPFUL') ? 'primary' : 'secondary'} icon={<ThumbsUp size={15} />} onClick={() => void react('HELPFUL')}>有帮助 {community?.reactions.HELPFUL || 0}</Button><Button size="sm" variant={community?.bookmarked ? 'primary' : 'secondary'} icon={<Bookmark size={15} />} onClick={() => void bookmark()}>{community?.bookmarked ? '已收藏' : '收藏'}</Button><Button size="sm" variant="ghost" icon={<Flag size={15} />} onClick={() => void report()}>举报文章</Button></div></div>
    <div className={styles.commentComposer}>{replyTo && <div className={styles.replying}>正在回复 {replyTo.author.username}<Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>取消</Button></div>}<Textarea rows={3} maxLength={5000} value={content} onChange={event => setContent(event.target.value)} placeholder="理性讨论，补充解法或指出问题……" /><div><span><MessageCircle size={15} /> {community?.commentCount || 0} 条评论</span><Button loading={busy} disabled={!content.trim()} onClick={() => void submit()}>发表评论</Button></div></div>
    <div className={styles.comments}>{comments.length ? comments.map(item => renderComment(item)) : <p className={styles.muted}>还没有评论，来分享你的思路吧。</p>}</div>
  </section>
}
