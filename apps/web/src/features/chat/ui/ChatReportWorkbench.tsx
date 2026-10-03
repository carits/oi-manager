'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ChatReportDetail, ChatReportStatus, ChatReportSummary } from '@oi-manager/contracts'
import { Button } from '@/components/ui/Button'
import { FormDialog } from '@/components/ui/Dialogs'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Table } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'
import { reviewStatusLabel } from '@/lib/humanPresentation'
import { publicErrorMessage } from '@/lib/humanErrors'
import { getPlatformChatReport, listPlatformChatReports, reviewPlatformChatReport } from '../api/chatApi'
import styles from './ChatReportWorkbench.module.css'

const errorMessage = publicErrorMessage

export function ChatReportWorkbench() {
  const toast = useToast()
  const [items, setItems] = useState<ChatReportSummary[]>([])
  const [status, setStatus] = useState<ChatReportStatus>('pending')
  const [selected, setSelected] = useState<ChatReportSummary>()
  const [detail, setDetail] = useState<ChatReportDetail>()
  const [accessReason, setAccessReason] = useState('处理用户举报')
  const [resolutionNote, setResolutionNote] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await listPlatformChatReports(status)
      setItems(response.items)
    } catch (error) {
      toast.error(errorMessage(error, '举报列表加载失败'))
    }
  }, [status, toast])

  useEffect(() => { void load() }, [load])

  const reveal = async () => {
    if (!selected || !accessReason.trim()) return
    setLoading(true)
    try {
      setDetail(await getPlatformChatReport(selected.id, accessReason.trim()))
    } catch (error) {
      toast.error(errorMessage(error, '详情加载失败'))
    } finally {
      setLoading(false)
    }
  }

  const decide = async (action: 'resolve' | 'dismiss') => {
    if (!selected || !resolutionNote.trim()) return
    setLoading(true)
    try {
      const response = await reviewPlatformChatReport(selected.id, action, resolutionNote.trim())
      if (!response.ok) return toast.error(response.error.userMessage || '处理失败')
      toast.success('举报已处理')
      setSelected(undefined)
      setDetail(undefined)
      setResolutionNote('')
      await load()
    } finally {
      setLoading(false)
    }
  }

  return <PageFrame>
    <PageHeader title="私信举报" description="仅可查看用户主动举报的有限上下文；每次查看都会记录平台审计。" actions={<Select aria-label="举报状态" value={status} onChange={event => setStatus(event.target.value as ChatReportStatus)}><option value="pending">待处理</option><option value="resolved">已处理</option><option value="dismissed">已驳回</option></Select>} />
    <Table data={items} columns={[{ key: 'createdAt', label: '举报时间', render: item => new Date(item.createdAt).toLocaleString('zh-CN') }, { key: 'Reporter.username', label: '举报人' }, { key: 'Target.username', label: '被举报人' }, { key: 'reason', label: '原因' }, { key: 'status', label: '状态', render: item => <StatusBadge variant={item.status === 'pending' ? 'warning' : item.status === 'resolved' ? 'success' : 'neutral'}>{reviewStatusLabel(item.status)}</StatusBadge> }]} actions={item => <Button variant="secondary" onClick={() => { setSelected(item); setDetail(undefined); setResolutionNote(''); setAccessReason('处理用户举报') }}>审核</Button>} emptyText="暂无举报" />
    <FormDialog isOpen={Boolean(selected)} onClose={() => { setSelected(undefined); setDetail(undefined) }} title="举报审核" description="查看证据需要填写原因，系统将记录操作者、举报和原因。" size="lg" footer={detail ? <><Button variant="secondary" onClick={() => { setSelected(undefined); setDetail(undefined) }}>关闭</Button>{selected?.status === 'pending' && <><Button variant="secondary" loading={loading} disabled={!resolutionNote.trim()} onClick={() => void decide('dismiss')}>驳回</Button><Button loading={loading} disabled={!resolutionNote.trim()} onClick={() => void decide('resolve')}>确认处理</Button></>}</> : <><Button variant="secondary" onClick={() => setSelected(undefined)}>取消</Button><Button loading={loading} disabled={!accessReason.trim()} onClick={() => void reveal()}>查看证据</Button></>}>
      {!detail ? <label className={styles.field}>查看原因<Input value={accessReason} maxLength={500} onChange={event => setAccessReason(event.target.value)} /></label> : <div className={styles.detail}><dl><div><dt>举报人</dt><dd>{detail.Reporter.username}</dd></div><div><dt>被举报人</dt><dd>{detail.Target.username}</dd></div><div><dt>原因</dt><dd>{detail.reason}</dd></div></dl><h3>举报上下文</h3>{Array.isArray(detail.evidenceSnapshot) ? <div className={styles.evidence}>{detail.evidenceSnapshot.map(message => <article key={message.id} data-reported={message.id === detail.messageId}><strong>{message.Sender?.username || '用户'}</strong>{message.messageType === 'sticker' && message.Sticker ? <img className={styles.sticker} src={`/api/chat/stickers/${message.Sticker.id}/poster`} alt={message.Sticker.label} /> : <p>{message.content}</p>}<time>{new Date(message.createdAt).toLocaleString('zh-CN')}</time></article>)}</div> : <p>证据保留期已结束，原文已经最小化清理；完整性摘要仍保留在审计记录中。</p>}{selected?.status === 'pending' && <label className={styles.field}>处理说明<Textarea rows={4} maxLength={2000} value={resolutionNote} onChange={event => setResolutionNote(event.target.value)} /></label>}</div>}
    </FormDialog>
  </PageFrame>
}
