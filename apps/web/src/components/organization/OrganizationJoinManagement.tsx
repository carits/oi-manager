'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { FormDialog } from '@/components/ui/Dialogs'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { useToast } from '@/components/ui/Toast'
import styles from './OrganizationJoinManagement.module.css'

type Application = { id: string; realName: string; requestedRole: string; requestedRelationType: string; profileData?: Record<string, unknown>; message?: string | null; status: string; createdAt: string; decisionMessage?: string | null; internalReviewNote?: string | null; User: { username: string } }
type Invitation = { id: string; memberRole: string; relationType: string; status: string; createdAt: string; expiresAt?: string | null; User: { username: string } }
type ListPayload<T> = { items: T[]; total: number; pending: number }
type Teacher = { membershipId: string; name: string }

export function JoinApplicationsManagement({ organizationId, isPrincipal, initialApplicationId }: { organizationId: string; isPrincipal: boolean; initialApplicationId?: string | null }) {
  const toast = useToast()
  const [items, setItems] = useState<Application[]>([]), [loading, setLoading] = useState(true), [selected, setSelected] = useState<Application | null>(null)
  const [teachers, setTeachers] = useState<Teacher[]>([]), [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ relationType: '', name: '', enrollmentYear: '', title: '', headTeacherMembershipId: '', decisionMessage: '', internalReviewNote: '' })
  const load = async () => {
    setLoading(true)
    const response = await apiClient.get<ListPayload<Application>>(`/api/organizations/${organizationId}/join-applications?pageSize=50`)
    setLoading(false)
    if (response.success && response.data) { setItems(response.data.items); if (initialApplicationId && !selected) setSelected(response.data.items.find(item => item.id === initialApplicationId) || null) }
    else toast.error(response.message || '申请列表加载失败')
  }
  useEffect(() => { void load(); if (isPrincipal) void apiClient.get<{ data: Teacher[] }>(`/api/organizations/${organizationId}/members/teachers?pageSize=100`).then(response => setTeachers(response.data?.data || [])) }, [organizationId])
  const open = (item: Application) => {
    setSelected(item); const profile = item.profileData || {}
    setForm({ relationType: item.requestedRelationType, name: item.realName, enrollmentYear: String(profile.enrollmentYear || ''), title: String(profile.title || ''), headTeacherMembershipId: '', decisionMessage: '', internalReviewNote: '' })
  }
  const decide = async (decision: 'approve' | 'reject') => {
    if (!selected) return
    setSaving(true)
    const response = await apiClient.post(`/api/organizations/${organizationId}/join-applications/${selected.id}/${decision}`, { relationType: form.relationType, headTeacherMembershipId: form.headTeacherMembershipId || null, profile: selected.requestedRole === 'student' ? { name: form.name, enrollmentYear: Number(form.enrollmentYear) || null } : { name: form.name, title: form.title }, decisionMessage: form.decisionMessage, internalReviewNote: form.internalReviewNote })
    setSaving(false)
    if (!response.success) return toast.error(response.message || '审核失败')
    toast.success(decision === 'approve' ? '申请已通过' : '申请已拒绝'); setSelected(null); await load()
  }
  const columns: DataTableColumn<Application>[] = [
    { key: 'applicant', label: '申请人', render: item => <span><strong>{item.realName}</strong><small className={styles.secondary}>{item.User.username}</small></span> },
    { key: 'role', label: '身份', render: item => item.requestedRole === 'teacher' ? '教师' : '学生' },
    { key: 'message', label: '申请说明', render: item => item.message || '—' },
    { key: 'createdAt', label: '申请时间', render: item => new Date(item.createdAt).toLocaleString('zh-CN') },
    { key: 'status', label: '状态', render: item => statusLabel(item.status) },
  ]
  return <div className={styles.root}><DataTable data={items} columns={columns} loading={loading} emptyText="暂无加入申请" actions={item => <Button variant="secondary" size="sm" onClick={() => open(item)}>查看</Button>} />
    <FormDialog isOpen={Boolean(selected)} onClose={() => setSelected(null)} title="加入申请" description={selected ? `${selected.realName}（${selected.User.username}）` : ''} size="md" loading={saving} footer={<div className={styles.dialogActions}><Button variant="secondary" disabled={saving} onClick={() => setSelected(null)}>取消</Button>{selected?.status === 'pending' && <><Button variant="danger" disabled={saving} onClick={() => void decide('reject')}>拒绝</Button><Button disabled={saving} onClick={() => void decide('approve')}>同意加入</Button></>}</div>}>
      {selected && <div className={styles.form}><div className={styles.summary}><span>申请身份：{selected.requestedRole === 'teacher' ? '教师' : '学生'}</span><span>申请说明：{selected.message || '无'}</span></div><label>真实姓名<Input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label>成员类型<Select value={form.relationType} onChange={event => setForm(current => ({ ...current, relationType: event.target.value }))}>{selected.requestedRole === 'student' ? <><option value="enrolled">本校学生</option><option value="preselected">预选学生</option></> : <><option value="employee">本校教师</option><option value="external_coach">外聘教练</option></>}</Select></label>{selected.requestedRole === 'student' ? <><label>入学年份<Input inputMode="numeric" value={form.enrollmentYear} onChange={event => setForm(current => ({ ...current, enrollmentYear: event.target.value }))} /></label>{isPrincipal && <label>负责教师<Select value={form.headTeacherMembershipId} onChange={event => setForm(current => ({ ...current, headTeacherMembershipId: event.target.value }))}><option value="">暂不指定</option>{teachers.map(item => <option value={item.membershipId} key={item.membershipId}>{item.name}</option>)}</Select></label>}</> : <label>学科 / 职务<Input value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label>}<label>申请人可见说明<Textarea rows={3} value={form.decisionMessage} onChange={event => setForm(current => ({ ...current, decisionMessage: event.target.value }))} /></label><label>内部审核备注<Textarea rows={3} value={form.internalReviewNote} onChange={event => setForm(current => ({ ...current, internalReviewNote: event.target.value }))} /></label></div>}
    </FormDialog>
  </div>
}

export function OrganizationInvitationsManagement({ organizationId, isPrincipal }: { organizationId: string; isPrincipal: boolean }) {
  const toast = useToast(), [items, setItems] = useState<Invitation[]>([]), [loading, setLoading] = useState(true), [open, setOpen] = useState(false), [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ username: '', memberRole: 'student', relationType: 'enrolled', message: '' })
  const [joinPolicy, setJoinPolicy] = useState('invite_only')
  const load = async () => { setLoading(true); const response = await apiClient.get<ListPayload<Invitation>>(`/api/organizations/${organizationId}/invitations?pageSize=50`); setLoading(false); if (response.success && response.data) setItems(response.data.items); else toast.error(response.message || '邀请列表加载失败') }
  useEffect(() => { void load(); if (isPrincipal) void apiClient.get<{ joinPolicy?: string }>(`/api/organizations/${organizationId}/members/campus`).then(response => setJoinPolicy(response.data?.joinPolicy || 'invite_only')) }, [organizationId, isPrincipal])
  const changePolicy = async (value: string) => { const response = await apiClient.patch<{ joinPolicy: string }>(`/api/organizations/${organizationId}/join-policy`, { joinPolicy: value }); if (!response.success) return toast.error(response.message || '加入策略更新失败'); setJoinPolicy(response.data?.joinPolicy || value); toast.success('加入策略已更新') }
  const invite = async () => { setSaving(true); const response = await apiClient.post(`/api/organizations/${organizationId}/invitations`, form); setSaving(false); if (!response.success) return toast.error(response.message || '邀请失败'); toast.success('邀请已发送'); setOpen(false); setForm({ username: '', memberRole: 'student', relationType: 'enrolled', message: '' }); await load() }
  const revoke = async (id: string) => { const response = await apiClient.post(`/api/organizations/${organizationId}/invitations/${id}/revoke`); if (!response.success) return toast.error(response.message || '撤回失败'); await load() }
  const columns: DataTableColumn<Invitation>[] = [{ key: 'username', label: '用户', render: item => item.User.username }, { key: 'role', label: '身份', render: item => item.memberRole === 'teacher' ? '教师' : '学生' }, { key: 'createdAt', label: '邀请时间', render: item => new Date(item.createdAt).toLocaleString('zh-CN') }, { key: 'expiresAt', label: '有效期', render: item => item.expiresAt ? new Date(item.expiresAt).toLocaleString('zh-CN') : '长期' }, { key: 'status', label: '状态', render: item => statusLabel(item.status) }]
  return <div className={styles.root}><div className={styles.toolbar}>{isPrincipal && <label className={styles.policy}>加入策略<Select value={joinPolicy} onChange={event => void changePolicy(event.target.value)}><option value="invite_only">仅限邀请</option><option value="approval">允许申请，需审核</option><option value="closed">关闭加入</option></Select></label>}<Button onClick={() => setOpen(true)} disabled={joinPolicy === 'closed'}>邀请成员</Button></div><DataTable data={items} columns={columns} loading={loading} emptyText="暂无邀请记录" actions={item => item.status === 'pending' ? <Button variant="secondary" size="sm" onClick={() => void revoke(item.id)}>撤回</Button> : null} />
    <FormDialog isOpen={open} onClose={() => setOpen(false)} onSubmit={() => void invite()} title="邀请加入学校" size="md" submitText="发送邀请" loading={saving} dirty={Boolean(form.username || form.message)}><div className={styles.form}><label>用户名<Input value={form.username} onChange={event => setForm(current => ({ ...current, username: event.target.value }))} /></label>{isPrincipal && <label>成员身份<Select value={form.memberRole} onChange={event => setForm(current => ({ ...current, memberRole: event.target.value, relationType: event.target.value === 'teacher' ? 'employee' : 'enrolled' }))}><option value="student">学生</option><option value="teacher">教师</option></Select></label>}<label>成员类型<Select value={form.relationType} onChange={event => setForm(current => ({ ...current, relationType: event.target.value }))}>{form.memberRole === 'teacher' ? <><option value="employee">本校教师</option><option value="external_coach">外聘教练</option></> : <><option value="enrolled">本校学生</option><option value="preselected">预选学生</option></>}</Select></label><label>邀请说明<Textarea rows={4} value={form.message} onChange={event => setForm(current => ({ ...current, message: event.target.value }))} /></label></div></FormDialog>
  </div>
}

function statusLabel(status: string) { return ({ pending: '待处理', approved: '已通过', rejected: '已拒绝', cancelled: '已撤销', accepted: '已接受', declined: '已拒绝', revoked: '已撤回', expired: '已过期' } as Record<string, string>)[status] || status }
