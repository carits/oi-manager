'use client'

import { useEffect, useState } from 'react'
import {
  createOrganizationInvitation,
  decideOrganizationJoinApplication,
  getOrganizationCampus,
  getOrganizationInvitations,
  getOrganizationJoinApplications,
  getOrganizationTeacherOptions,
  revokeOrganizationInvitation,
  updateOrganizationJoinPolicy,
  type OrganizationInvitation as Invitation,
  type OrganizationJoinApplication as Application,
  type OrganizationTeacherOption as Teacher,
} from '@/features/organization-account'
import { Button } from '@/components/ui/Button'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { FormDialog } from '@/components/ui/Dialogs'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { useToast } from '@/components/ui/Toast'
import styles from './OrganizationJoinManagement.module.css'

export function JoinApplicationsManagement({ organizationId, isPrincipal, initialApplicationId, onOpenSettings }: { organizationId: string; isPrincipal: boolean; initialApplicationId?: string | null; onOpenSettings?: () => void }) {
  const toast = useToast()
  const [items, setItems] = useState<Application[]>([]), [loading, setLoading] = useState(true), [selected, setSelected] = useState<Application | null>(null)
  const [listError, setListError] = useState(''), [policyError, setPolicyError] = useState(''), [teacherError, setTeacherError] = useState('')
  const [teachers, setTeachers] = useState<Teacher[]>([]), [saving, setSaving] = useState(false)
  const [joinPolicy, setJoinPolicy] = useState<string | null>(null)
  const [form, setForm] = useState({ relationType: '', name: '', enrollmentYear: '', title: '', headTeacherMembershipId: '', decisionMessage: '', internalReviewNote: '' })
  const selectApplication = (item: Application) => {
    const profile = item.profileData || {}
    setSelected(item)
    setForm({ relationType: item.requestedRelationType, name: item.realName, enrollmentYear: String(profile.enrollmentYear || ''), title: String(profile.title || ''), headTeacherMembershipId: '', decisionMessage: '', internalReviewNote: '' })
  }
  const load = async () => {
    setLoading(true)
    setListError('')
    try {
      const response = await getOrganizationJoinApplications(organizationId)
      setItems(response.items)
      const linkedApplication = initialApplicationId && !selected ? response.items.find(item => item.id === initialApplicationId) : undefined
      if (linkedApplication) selectApplication(linkedApplication)
    } catch (error) {
      const message = errorMessage(error, '申请列表加载失败')
      setListError(message); toast.error(message)
    } finally { setLoading(false) }
  }
  const loadPolicy = async () => {
    setPolicyError('')
    try { setJoinPolicy((await getOrganizationCampus(organizationId)).joinPolicy) }
    catch (error) { setJoinPolicy(null); setPolicyError(errorMessage(error, '加入设置加载失败')) }
  }
  const loadTeachers = async () => {
    setTeacherError('')
    try { setTeachers((await getOrganizationTeacherOptions(organizationId)).data) }
    catch (error) { const message = errorMessage(error, '教师列表加载失败'); setTeacherError(message); toast.error(message) }
  }
  useEffect(() => { void load(); void loadPolicy(); if (isPrincipal) void loadTeachers() }, [organizationId])
  const open = (item: Application) => selectApplication(item)
  const decide = async (decision: 'approve' | 'reject') => {
    if (!selected) return
    setSaving(true)
    try {
      await decideOrganizationJoinApplication(organizationId, selected.id, decision, { relationType: form.relationType, headTeacherMembershipId: form.headTeacherMembershipId || null, profile: selected.requestedRole === 'student' ? { name: form.name, enrollmentYear: Number(form.enrollmentYear) || null } : { name: form.name, title: form.title }, decisionMessage: form.decisionMessage, internalReviewNote: form.internalReviewNote })
      toast.success(decision === 'approve' ? '申请已通过' : '申请已拒绝'); setSelected(null); await load()
    } catch (error) { toast.error(errorMessage(error, '审核失败')) }
    finally { setSaving(false) }
  }
  const columns: DataTableColumn<Application>[] = [
    { key: 'applicant', label: '申请人', render: item => <span><strong>{item.realName}</strong><small className={styles.secondary}>{item.User.username}</small></span> },
    { key: 'role', label: '身份', render: item => item.requestedRole === 'teacher' ? '教师' : '学生' },
    { key: 'message', label: '申请说明', render: item => item.message || '—' },
    { key: 'createdAt', label: '申请时间', render: item => new Date(item.createdAt).toLocaleString('zh-CN') },
    { key: 'status', label: '状态', render: item => statusLabel(item.status) },
  ]
  const emptyText = joinPolicy === 'approval' ? '暂无加入申请' : joinPolicy === 'closed' ? '当前已关闭申请与普通成员邀请' : joinPolicy === 'invite_only' ? '当前仅限邀请，不接收用户主动申请' : '加入策略暂时无法读取'
  return <div className={styles.root}>{listError && <div className={styles.summary} role="alert"><span>{listError}，没有将读取失败显示成“暂无申请”。</span><Button variant="secondary" size="sm" onClick={() => void load()}>重试申请列表</Button></div>}{policyError && <div className={styles.summary} role="alert"><span>{policyError}</span><Button variant="secondary" size="sm" onClick={() => void loadPolicy()}>重试加入设置</Button></div>}{teacherError && <div className={styles.summary} role="alert"><span>{teacherError}，审核学生时暂不能指定负责教师。</span><Button variant="secondary" size="sm" onClick={() => void loadTeachers()}>重试教师列表</Button></div>}{isPrincipal && joinPolicy && joinPolicy !== 'approval' && <div className={styles.summary}><span>{emptyText}</span>{onOpenSettings && <Button variant="secondary" size="sm" onClick={onOpenSettings}>调整加入设置</Button>}</div>}{(!listError || items.length > 0) && <DataTable data={items} columns={columns} loading={loading} emptyText={emptyText} actions={item => <Button variant="secondary" size="sm" onClick={() => open(item)}>{item.status === 'pending' ? '审核' : '查看'}</Button>} />}
    <FormDialog isOpen={Boolean(selected)} onClose={() => setSelected(null)} title="加入申请" description={selected ? `${selected.realName}（${selected.User.username}）` : ''} size="md" loading={saving} footer={<div className={styles.dialogActions}><Button variant="secondary" disabled={saving} onClick={() => setSelected(null)}>取消</Button>{selected?.status === 'pending' && <><Button variant="danger" disabled={saving} onClick={() => void decide('reject')}>拒绝</Button><Button disabled={saving} onClick={() => void decide('approve')}>同意加入</Button></>}</div>}>
      {selected && <div className={styles.form}><div className={styles.summary}><span>申请身份：{selected.requestedRole === 'teacher' ? '教师' : '学生'}</span><span>申请说明：{selected.message || '无'}</span></div><label>真实姓名<Input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} /></label><label>成员类型<Select value={form.relationType} onChange={event => setForm(current => ({ ...current, relationType: event.target.value }))}>{selected.requestedRole === 'student' ? <><option value="enrolled">本校学生</option><option value="preselected">预选学生</option></> : <><option value="employee">本校教师</option><option value="external_coach">外聘教练</option></>}</Select></label>{selected.requestedRole === 'student' ? <><label>入学年份<Input inputMode="numeric" value={form.enrollmentYear} onChange={event => setForm(current => ({ ...current, enrollmentYear: event.target.value }))} /></label>{isPrincipal && <label>负责教师<Select value={form.headTeacherMembershipId} onChange={event => setForm(current => ({ ...current, headTeacherMembershipId: event.target.value }))}><option value="">暂不指定</option>{teachers.map(item => <option value={item.membershipId} key={item.membershipId}>{item.name}</option>)}</Select></label>}</> : <label>学科 / 职务<Input value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label>}<label>申请人可见说明<Textarea rows={3} value={form.decisionMessage} onChange={event => setForm(current => ({ ...current, decisionMessage: event.target.value }))} /></label><label>内部审核备注<Textarea rows={3} value={form.internalReviewNote} onChange={event => setForm(current => ({ ...current, internalReviewNote: event.target.value }))} /></label></div>}
    </FormDialog>
  </div>
}

export function OrganizationInvitationsManagement({ organizationId, isPrincipal }: { organizationId: string; isPrincipal: boolean }) {
  const toast = useToast(), [items, setItems] = useState<Invitation[]>([]), [loading, setLoading] = useState(true), [open, setOpen] = useState(false), [saving, setSaving] = useState(false)
  const [listError, setListError] = useState(''), [policyError, setPolicyError] = useState('')
  const [form, setForm] = useState({ username: '', memberRole: 'student', relationType: 'enrolled', message: '' })
  const [joinPolicy, setJoinPolicy] = useState<string | null>(null)
  const load = async () => { setLoading(true); setListError(''); try { setItems((await getOrganizationInvitations(organizationId)).items) } catch (error) { const message = errorMessage(error, '邀请列表加载失败'); setListError(message); toast.error(message) } finally { setLoading(false) } }
  const loadPolicy = async () => { setPolicyError(''); try { setJoinPolicy((await getOrganizationCampus(organizationId)).joinPolicy) } catch (error) { setJoinPolicy(null); setPolicyError(errorMessage(error, '加入设置加载失败')) } }
  useEffect(() => { void load(); void loadPolicy() }, [organizationId])
  const invite = async () => { setSaving(true); try { await createOrganizationInvitation(organizationId, { ...form, memberRole: form.memberRole as 'student' | 'teacher' }); toast.success('邀请已发送'); setOpen(false); setForm({ username: '', memberRole: 'student', relationType: 'enrolled', message: '' }); await load() } catch (error) { toast.error(errorMessage(error, '邀请失败')) } finally { setSaving(false) } }
  const revoke = async (id: string) => { try { await revokeOrganizationInvitation(organizationId, id); await load() } catch (error) { toast.error(errorMessage(error, '撤回失败')) } }
  const columns: DataTableColumn<Invitation>[] = [{ key: 'username', label: '用户', render: item => item.User?.username || '—' }, { key: 'role', label: '身份', render: item => item.memberRole === 'teacher' ? '教师' : '学生' }, { key: 'createdAt', label: '邀请时间', render: item => new Date(item.createdAt).toLocaleString('zh-CN') }, { key: 'expiresAt', label: '有效期', render: item => item.expiresAt ? new Date(item.expiresAt).toLocaleString('zh-CN') : '长期' }, { key: 'status', label: '状态', render: item => statusLabel(item.status) }]
  return <div className={styles.root}>{listError && <div className={styles.summary} role="alert"><span>{listError}，没有将读取失败显示成“暂无邀请”。</span><Button variant="secondary" size="sm" onClick={() => void load()}>重试邀请列表</Button></div>}{policyError && <div className={styles.summary} role="alert"><span>{policyError}</span><Button variant="secondary" size="sm" onClick={() => void loadPolicy()}>重试加入设置</Button></div>}<div className={styles.toolbar}><Button onClick={() => setOpen(true)} disabled={!joinPolicy || joinPolicy === 'closed'}>邀请成员</Button>{joinPolicy === 'closed' && <span className={styles.secondary}>当前加入设置禁止发送新邀请</span>}{!joinPolicy && <span className={styles.secondary}>加入设置尚未加载，暂不能发送邀请</span>}</div>{(!listError || items.length > 0) && <DataTable data={items} columns={columns} loading={loading} emptyText="暂无邀请记录" actions={item => item.status === 'pending' ? <Button variant="secondary" size="sm" onClick={() => void revoke(item.id)}>撤回</Button> : null} />}
    <FormDialog isOpen={open} onClose={() => setOpen(false)} onSubmit={() => void invite()} title="邀请加入学校" size="md" submitText="发送邀请" loading={saving} dirty={Boolean(form.username || form.message)}><div className={styles.form}><label>用户名<Input value={form.username} onChange={event => setForm(current => ({ ...current, username: event.target.value }))} /></label>{isPrincipal && <label>成员身份<Select value={form.memberRole} onChange={event => setForm(current => ({ ...current, memberRole: event.target.value, relationType: event.target.value === 'teacher' ? 'employee' : 'enrolled' }))}><option value="student">学生</option><option value="teacher">教师</option></Select></label>}<label>成员类型<Select value={form.relationType} onChange={event => setForm(current => ({ ...current, relationType: event.target.value }))}>{form.memberRole === 'teacher' ? <><option value="employee">本校教师</option><option value="external_coach">外聘教练</option></> : <><option value="enrolled">本校学生</option><option value="preselected">预选学生</option></>}</Select></label><label>邀请说明<Textarea rows={4} value={form.message} onChange={event => setForm(current => ({ ...current, message: event.target.value }))} /></label></div></FormDialog>
  </div>
}

export function OrganizationJoinSettings({ organizationId }: { organizationId: string }) {
  const toast = useToast()
  const [joinPolicy, setJoinPolicy] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const load = async () => {
    setLoading(true); setLoadError('')
    try { setJoinPolicy((await getOrganizationCampus(organizationId)).joinPolicy) }
    catch (error) { setJoinPolicy(null); setLoadError(errorMessage(error, '加入设置加载失败')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [organizationId])
  const save = async () => { if (!joinPolicy) return; setSaving(true); try { await updateOrganizationJoinPolicy(organizationId, joinPolicy as 'invite_only' | 'approval' | 'closed'); toast.success('加入设置已更新') } catch (error) { toast.error(errorMessage(error, '加入设置更新失败')) } finally { setSaving(false) } }
  if (loadError) return <div className={styles.root}><div className={styles.summary} role="alert"><span>{loadError}，当前策略未知，未使用默认值代替。</span><Button variant="secondary" onClick={() => void load()}>重新加载加入设置</Button></div></div>
  return <div className={styles.root}><div className={styles.form}><label>加入策略<Select value={joinPolicy || ''} disabled={loading || saving} onChange={event => setJoinPolicy(event.target.value)}><option value="invite_only">仅限邀请</option><option value="approval">允许主动申请，需审核</option><option value="closed">关闭加入</option></Select></label><div className={styles.summary}>{joinPolicy === 'approval' ? '用户可以在学校目录中提交加入申请，由教师或负责人审核。' : joinPolicy === 'closed' ? '禁止新的主动申请和普通成员邀请，现有成员不受影响。' : '用户不能主动申请，只能处理学校发出的邀请。'}</div><Button onClick={() => void save()} loading={saving} disabled={loading}>保存加入设置</Button></div></div>
}

function statusLabel(status: string) { return ({ pending: '待处理', approved: '已通过', rejected: '已拒绝', cancelled: '已撤销', accepted: '已接受', declined: '已拒绝', revoked: '已撤回', expired: '已过期' } as Record<string, string>)[status] || status }
function errorMessage(error: unknown, fallback: string) { return error instanceof Error && error.message ? error.message : fallback }
