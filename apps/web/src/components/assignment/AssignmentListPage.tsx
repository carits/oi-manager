'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowRight, CalendarClock, ListChecks, Plus, Users } from 'lucide-react'
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
import { type Assignment, type AssignmentListPayload, type AssignmentStatus, assignmentStatusMeta, formatAssignmentTime } from './types'

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
  const [openAt, setOpenAt] = useState(localInput(now))
  const [dueAt, setDueAt] = useState(localInput(new Date(now.getTime() + 24 * 3_600_000)))
  const [closeAt, setCloseAt] = useState(localInput(new Date(now.getTime() + 48 * 3_600_000)))
  const [latePolicy, setLatePolicy] = useState('DISALLOW')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    const result = await apiClient.mutate<Assignment>('/api/assignments', 'POST', { organizationId, title, description, openAt, dueAt, closeAt, latePolicy })
    setSaving(false)
    if (!result.ok) return toast.error(result.error.message)
    toast.success('作业草稿已创建，请继续配置题目和名单')
    onCreated(result.data)
  }

  return <FormDialog isOpen={open} onClose={onClose} onSubmit={() => void submit()} title="创建作业草稿" description="创建后进入独立作业工作台，配置题目版本、名单和发布规则。" submitText="创建并配置" loading={saving} dirty={Boolean(title || description)} submitDisabled={!title.trim()} size="lg">
    <div className={styles.dialogGrid}>
      <div className={styles.full}><FormField label="作业名称" required><Input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} /></FormField></div>
      <div className={styles.full}><FormField label="作业说明"><Textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={10000} /></FormField></div>
      <FormField label="开放时间" required><Input type="datetime-local" value={openAt} onChange={event => setOpenAt(event.target.value)} /></FormField>
      <FormField label="截止时间" required><Input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /></FormField>
      <FormField label="关闭时间" required hint="关闭后不再接收提交"><Input type="datetime-local" value={closeAt} onChange={event => setCloseAt(event.target.value)} /></FormField>
      <FormField label="迟交策略"><Select value={latePolicy} onChange={event => setLatePolicy(event.target.value)}><option value="DISALLOW">不允许迟交</option><option value="ALLOW_MARK_LATE">允许并标记迟交</option><option value="ALLOW_NO_PENALTY">允许且不扣分</option><option value="ALLOW_WITH_PENALTY">允许并按比例扣分</option></Select></FormField>
    </div>
  </FormDialog>
}

function visibleByFilter(item: Assignment, filter: Filter) {
  if (filter === 'draft') return item.status === 'DRAFT'
  if (filter === 'active') return ['SCHEDULED', 'OPEN', 'OVERDUE'].includes(item.status)
  if (filter === 'finished') return ['CLOSED', 'REVIEWING', 'RELEASED', 'ARCHIVED', 'CANCELLED'].includes(item.status)
  return true
}

export function AssignmentListPage({ canManage }: { canManage: boolean }) {
  const { organizationId } = useParams<{ organizationId: string }>()
  const { sessionKey } = useAuth()
  const [filter, setFilter] = useState<Filter>(canManage ? 'active' : 'all')
  const [creating, setCreating] = useState(false)
  const resource = useResource<AssignmentListPayload>(`/api/assignments?organizationId=${organizationId}&pageSize=100`, { sessionKey, isEmpty: data => data.items.length === 0, dedupingInterval: 15000 })
  const assignments = resource.data?.items || []
  const visible = assignments.filter(item => visibleByFilter(item, filter))
  const base = `/org/${organizationId}/homeworks`
  return <PageFrame>
    <PageHeader title="作业" description={canManage ? '创建、发布和批改固定测试版本的独立作业。' : '查看作业要求、完成题目并跟踪订正反馈。'} actions={canManage ? <Button icon={<Plus size={17} />} onClick={() => setCreating(true)}>创建作业</Button> : undefined} />
    <Tabs label="作业状态" value={filter} onChange={setFilter} items={[
      { value: 'active', label: '进行中', count: assignments.filter(item => visibleByFilter(item, 'active')).length },
      ...(canManage ? [{ value: 'draft' as const, label: '草稿', count: assignments.filter(item => item.status === 'DRAFT').length }] : []),
      { value: 'finished', label: '已结束' }, { value: 'all', label: '全部', count: assignments.length },
    ]} />
    <AsyncRegion state={resource.state} onRetry={resource.retry} emptyText="当前没有作业" skeletonRows={5}>
      {() => visible.length ? <div className={styles.list}>{visible.map(item => {
        const status = assignmentStatusMeta[item.status as AssignmentStatus]
        return <Link key={item.id} href={`${base}/${item.id}`} className={styles.card}>
          <span className={styles.cardMain}><span className={styles.cardTitle}>{item.title}</span><span className={styles.cardMeta}><span><CalendarClock size={15} />{formatAssignmentTime(item.openAt)} 至 {formatAssignmentTime(item.closeAt)}</span><span><ListChecks size={15} />{item.problemCount} 题</span><span><Users size={15} />{item.recipientCount} 人</span></span></span>
          <span className={styles.cardEnd}><StatusBadge variant={status.variant}>{status.label}</StatusBadge><ArrowRight size={17} /></span>
        </Link>
      })}</div> : <p className={styles.muted}>当前筛选下没有作业。</p>}
    </AsyncRegion>
    <CreateAssignmentDialog open={creating} organizationId={organizationId} onClose={() => setCreating(false)} onCreated={item => { setCreating(false); window.location.assign(`${base}/${item.id}`) }} />
  </PageFrame>
}
