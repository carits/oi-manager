'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { FormDialog } from '@/components/ui/Dialogs'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Table } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import styles from './BlogModerationWorkbench.module.css'
import { reviewStatusLabel } from '@/lib/humanPresentation'

type Summary = {
  id: string; postId: string; commentId?: string | null; reason: string; status: string; createdAt: string
  Reporter: { id: string; username: string }
  Post: { id: string; slug: string; Author: { id: string; username: string }; CurrentVersion?: { title: string } | null }
}
type Detail = Summary & {
  details?: string | null; evidenceSnapshot: unknown; resolutionNote?: string | null
  Post: Summary['Post'] & { status: string; Features: Array<{ id: string; reason?: string | null }> }
  Comment?: { id: string; content: string; status: string } | null
}
type Page = { data: Summary[]; total: number }

export function BlogModerationWorkbench() {
  const toast = useToast()
  const [items, setItems] = useState<Summary[]>([])
  const [status, setStatus] = useState('pending')
  const [selected, setSelected] = useState<Summary>()
  const [detail, setDetail] = useState<Detail>()
  const [accessReason, setAccessReason] = useState('处理博客内容举报')
  const [resolutionNote, setResolutionNote] = useState('')
  const [moderationAction, setModerationAction] = useState('none')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const response = await apiClient.get<Page>(`/api/platform/blog-reports?status=${status}`, { accountScoped: true })
    if (response.success) setItems(response.data?.data || [])
    else toast.error(response.message || '博客举报加载失败')
  }, [status, toast])
  useEffect(() => { void load() }, [load])

  const reveal = async () => {
    if (!selected || accessReason.trim().length < 5) return
    setBusy(true)
    const response = await apiClient.get<Detail>(`/api/platform/blog-reports/${selected.id}?reason=${encodeURIComponent(accessReason.trim())}`, { accountScoped: true })
    setBusy(false)
    if (response.success && response.data) setDetail(response.data)
    else toast.error(response.message || '举报详情加载失败')
  }

  const decide = async (decision: 'resolved' | 'dismissed') => {
    if (!selected || resolutionNote.trim().length < 5) return
    if (moderationAction === 'hide_comment' && !selected.commentId) return toast.error('只有评论举报可以隐藏评论')
    setBusy(true)
    const response = await apiClient.post(`/api/platform/blog-reports/${selected.id}/decision`, { decision, action: decision === 'dismissed' ? 'none' : moderationAction, resolutionNote }, { accountScoped: true })
    setBusy(false)
    if (!response.success) return toast.error(response.message || '处理失败')
    toast.success('举报已处理')
    setSelected(undefined); setDetail(undefined); setResolutionNote(''); setModerationAction('none')
    await load()
  }

  const feature = async () => {
    if (!detail) return
    const active = detail.Post.Features.length === 0
    setBusy(true)
    const response = await apiClient.put(`/api/platform/blogs/${detail.postId}/featured`, { active, reason: resolutionNote.trim() || null }, { accountScoped: true })
    setBusy(false)
    if (!response.success) return toast.error(response.message || '精选状态更新失败')
    toast.success(active ? '已设为社区精选' : '已取消社区精选')
    await reveal()
  }

  return <PageFrame>
    <PageHeader title="博客治理" description="处理用户举报并维护社区精选；每次查看举报证据都会写入平台审计。" actions={<Select aria-label="举报状态" value={status} onChange={event => setStatus(event.target.value)}><option value="pending">待处理</option><option value="resolved">已处理</option><option value="dismissed">已驳回</option></Select>} />
    <Table data={items} columns={[
      { key: 'createdAt', label: '举报时间', render: item => new Date(item.createdAt).toLocaleString('zh-CN') },
      { key: 'Post.CurrentVersion.title', label: '文章' }, { key: 'Reporter.username', label: '举报人' },
      { key: 'reason', label: '原因' },
      { key: 'status', label: '状态', render: item => <StatusBadge variant={item.status === 'pending' ? 'warning' : item.status === 'resolved' ? 'success' : 'neutral'}>{reviewStatusLabel(item.status)}</StatusBadge> },
    ]} actions={item => <Button variant="secondary" onClick={() => { setSelected(item); setDetail(undefined); setResolutionNote(''); setModerationAction('none') }}>{item.status === 'pending' ? '审核' : '查看'}</Button>} emptyText="暂无博客举报" />
    <FormDialog isOpen={Boolean(selected)} onClose={() => { setSelected(undefined); setDetail(undefined) }} title="博客举报审核" description="证据只用于当前举报治理，查看行为会被审计。" size="lg" footer={detail ? <><Button variant="secondary" onClick={() => { setSelected(undefined); setDetail(undefined) }}>关闭</Button><Button variant="secondary" loading={busy} onClick={() => void feature()}>{detail.Post.Features.length ? '取消精选' : '设为精选'}</Button>{selected?.status === 'pending' && <><Button variant="secondary" loading={busy} disabled={resolutionNote.trim().length < 5} onClick={() => void decide('dismissed')}>驳回举报</Button><Button loading={busy} disabled={resolutionNote.trim().length < 5} onClick={() => void decide('resolved')}>确认处理</Button></>}</> : <><Button variant="secondary" onClick={() => setSelected(undefined)}>取消</Button><Button loading={busy} disabled={accessReason.trim().length < 5} onClick={() => void reveal()}>查看证据</Button></>}>
      {!detail ? <label className={styles.field}>查看原因<Input value={accessReason} maxLength={500} onChange={event => setAccessReason(event.target.value)} /></label> : <div className={styles.detail}>
        <dl className={styles.facts}><div><dt>文章</dt><dd>{detail.Post.CurrentVersion?.title || detail.postId}</dd></div><div><dt>作者</dt><dd>{detail.Post.Author.username}</dd></div><div><dt>举报人</dt><dd>{detail.Reporter.username}</dd></div><div><dt>对象</dt><dd>{detail.commentId ? '评论' : '文章'}</dd></div><div><dt>原因</dt><dd>{detail.reason}</dd></div><div><dt>状态</dt><dd>{reviewStatusLabel(detail.status)}</dd></div></dl>
        <section className={styles.evidence}><strong>固化证据摘要</strong><pre>{JSON.stringify(detail.evidenceSnapshot, null, 2)}</pre></section>
        {selected?.status === 'pending' && <><label className={styles.field}>治理动作<Select value={moderationAction} onChange={event => setModerationAction(event.target.value)}><option value="none">仅记录处理结果</option>{detail.commentId && <option value="hide_comment">隐藏被举报评论</option>}<option value="hold_post">暂停文章展示</option><option value="remove_post">移除文章</option></Select></label><label className={styles.field}>处理说明<Textarea rows={4} maxLength={5000} value={resolutionNote} onChange={event => setResolutionNote(event.target.value)} /></label></>}
      </div>}
    </FormDialog>
  </PageFrame>
}
