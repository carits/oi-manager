'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowRight, CalendarClock, History, ListChecks, Plus, Users } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import apiClient from '@/lib/apiClient'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { Button } from '@/components/ui/Button'
import { FormDialog } from '@/components/ui/Dialogs'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormField } from '@/components/ui/FormField'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import styles from './Assignment.module.css'
import { type Assignment, type AssignmentListPayload, type AssignmentStatus, assignmentStatusMeta, formatAssignmentTime } from '../model/types'

type Filter = 'active' | 'draft' | 'finished' | 'all'

function localInput(date: Date) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

function CreateAssignmentDialog({ open, organizationId, onClose, onCreated }: { open: boolean; organizationId: string; onClose: () => void; onCreated: (assignment: Assignment) => void }) {
  const toast = useToast()
  const now = new Date()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [publishAt, setPublishAt] = useState('')
  const [openAt, setOpenAt] = useState(localInput(now))
  const [dueAt, setDueAt] = useState(localInput(new Date(now.getTime() + 7 * 24 * 3_600_000)))
  const [closeAt, setCloseAt] = useState(localInput(new Date(now.getTime() + 7 * 24 * 3_600_000)))
  const [latePolicy, setLatePolicy] = useState('DISALLOW')
  const [latePenaltyPercent, setLatePenaltyPercent] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    const result = await apiClient.mutate<Assignment>('/api/assignments', 'POST', { organizationId, title, description, publishAt: publishAt || null, openAt, dueAt, closeAt, latePolicy, latePenaltyPercent: latePolicy === 'ALLOW_WITH_PENALTY' ? latePenaltyPercent : null })
    setSaving(false)
    if (!result.ok) return toast.error(result.error.message)
    toast.success('作业已创建，请继续选择题目和学生')
    onCreated(result.data)
  }

  return <FormDialog isOpen={open} onClose={onClose} onSubmit={() => void submit()} title="创建作业" description="先填写作业名称和截止时间，随后选择题目和学生。" submitText="创建并继续" loading={saving} dirty={Boolean(title || description)} submitDisabled={!title.trim()} size="lg">
    <div className={styles.dialogGrid}>
      <div className={styles.full}><FormField label="作业名称" required><Input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} /></FormField></div>
      <FormField label="截止时间" required><Input type="datetime-local" value={dueAt} onChange={event => { setDueAt(event.target.value); if (!advancedOpen) setCloseAt(event.target.value) }} /></FormField>
      <div className={styles.full}><Button variant="secondary" onClick={() => setAdvancedOpen(value => !value)} aria-expanded={advancedOpen}>{advancedOpen ? '收起高级设置' : '展开高级设置'}</Button></div>
      {advancedOpen && <>
      <div className={styles.full}><FormField label="作业说明"><Textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={10000} /></FormField></div>
      <FormField label="发布时间" hint="留空表示发布后立即可见"><Input type="datetime-local" value={publishAt} onChange={event => setPublishAt(event.target.value)} /></FormField>
      <FormField label="开放时间" required><Input type="datetime-local" value={openAt} onChange={event => setOpenAt(event.target.value)} /></FormField>
      <FormField label="关闭时间" required hint="关闭后不再接收提交"><Input type="datetime-local" value={closeAt} onChange={event => setCloseAt(event.target.value)} /></FormField>
      <FormField label="迟交策略"><Select value={latePolicy} onChange={event => setLatePolicy(event.target.value)}><option value="DISALLOW">不允许迟交</option><option value="ALLOW_MARK_LATE">允许并标记迟交</option><option value="ALLOW_NO_PENALTY">允许且不扣分</option><option value="ALLOW_WITH_PENALTY">允许并按比例扣分</option></Select></FormField>
      {latePolicy === 'ALLOW_WITH_PENALTY' && <FormField label="迟交扣分比例" required hint="0～100%"><Input type="number" min={0} max={100} value={latePenaltyPercent} onChange={event => setLatePenaltyPercent(Number(event.target.value))} /></FormField>}
      </>}
    </div>
  </FormDialog>
}

export function AssignmentListPage({ canManage }: { canManage: boolean }) {
  const { organizationId } = useParams<{ organizationId: string }>()
  const { sessionKey } = useAuth()
  const [filter, setFilter] = useState<Filter>('active')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const resource = useResource<AssignmentListPayload>(`/api/assignments?organizationId=${organizationId}&statusGroup=${filter}&page=${page}&pageSize=20`, { sessionKey, isEmpty: () => false, dedupingInterval: 15000 })
  const assignments = resource.data?.items || []
  const visible = assignments
  const counts = resource.data?.statusCounts || {}
  const activeCount = (counts.SCHEDULED || 0) + (counts.OPEN || 0) + (counts.OVERDUE || 0)
  const finishedCount = (counts.CLOSED || 0) + (counts.REVIEWING || 0) + (counts.RELEASED || 0) + (counts.ARCHIVED || 0) + (counts.CANCELLED || 0)
  const allCount = Object.values(counts).reduce((sum, count) => sum + (count || 0), 0)
  const base = `/org/${organizationId}/homeworks`
  return <PageFrame>
    <PageHeader title="作业" description={canManage ? '创建、布置和批改学生作业。' : '查看作业要求、完成题目并跟踪订正反馈。'} actions={canManage ? <Button icon={<Plus size={17} />} onClick={() => setCreating(true)}>创建作业</Button> : undefined} />
    <Tabs label="作业状态" value={filter} onChange={value => { setFilter(value as Filter); setPage(1) }} items={[
      { value: 'active', label: '进行中', count: activeCount },
      ...(canManage ? [{ value: 'draft' as const, label: '草稿', count: counts.DRAFT || 0 }] : []),
      { value: 'finished', label: '已结束', count: finishedCount }, { value: 'all', label: '全部', count: allCount },
    ]} />
    <AsyncRegion state={resource.state} onRetry={resource.retry} emptyText="当前没有作业" skeletonRows={5}>
      {() => visible.length ? <><div className={styles.list}>{visible.map(item => {
        const status = assignmentStatusMeta[item.status as AssignmentStatus]
        return <Link key={item.id} href={`${base}/${item.id}`} className={styles.card}>
          <span className={styles.cardMain}><span className={styles.cardTitle}>{item.title}</span><span className={styles.cardMeta}><span><CalendarClock size={15} />{formatAssignmentTime(item.openAt)} 至 {formatAssignmentTime(item.closeAt)}</span><span><ListChecks size={15} />{item.problemCount} 题</span><span><Users size={15} />{item.recipientCount} 人</span></span></span>
          <span className={styles.cardEnd}><StatusBadge variant={status.variant}>{status.label}</StatusBadge><ArrowRight size={17} /></span>
        </Link>
      })}</div>{(resource.data?.pagination.totalPages || 0) > 1 && <div className={styles.actions}><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button><span className={styles.muted}>第 {page} / {resource.data?.pagination.totalPages} 页</span><Button variant="secondary" disabled={page >= (resource.data?.pagination.totalPages || 1)} onClick={() => setPage(value => value + 1)}>下一页</Button></div>}</> : <div className={styles.stack}><p className={styles.muted}>{filter === 'active' ? '当前没有待完成作业。' : '当前筛选下没有作业。'}</p>{!canManage && filter === 'active' && allCount > 0 && <Button variant="secondary" icon={<History size={16} />} onClick={() => { setFilter('finished'); setPage(1) }}>查看历史作业</Button>}</div>}
    </AsyncRegion>
    <CreateAssignmentDialog open={creating} organizationId={organizationId} onClose={() => setCreating(false)} onCreated={item => { setCreating(false); window.location.assign(`${base}/${item.id}`) }} />
  </PageFrame>
}
