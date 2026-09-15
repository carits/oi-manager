'use client'

import { useEffect, useState } from 'react'
import { Building2, Search } from 'lucide-react'
import type { MyOrganizations, OrganizationCreationApplication, OrganizationDirectoryItem, OrganizationRelation } from '@oi-manager/contracts'
import { createClientUUID } from '@/lib/uuid'
import { Button } from '@/components/ui/Button'
import { FormDialog } from '@/components/ui/Dialogs'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Empty } from '@/components/ui/Empty'
import { useToast } from '@/components/ui/Toast'
import { RegionSelector } from '@/components/business/RegionSelector'
import {
  cancelOrganizationApplication, cancelOrganizationJoinApplication,
  createOrganizationApplication, createOrganizationJoinApplication,
  getMyOrganizationCreationApplications, getMyOrganizations,
  respondOrganizationInvitation, searchOrganizations,
} from '../api/organizationAccountApi'
import styles from './PersonalOrganizationsPage.module.css'

type CreationForm = {
  name: string; shortName: string
  schoolType: '' | '小学' | '初中' | '高中' | '小学+初中' | '初中+高中' | '小学+初中+高中'
  schoolNature: '' | '公办' | '民办' | '其他'
  educationSystem: '6-3-3' | '5-4-3'
  province: string; city: string; district: string; applicantRealName: string; applicantTitle: string
  contactPerson: string; contactPhone: string; contactEmail: string; description: string; evidenceNote: string
}

const emptyCreationForm: CreationForm = {
  name: '', shortName: '', schoolType: '', schoolNature: '', educationSystem: '6-3-3',
  province: '', city: '', district: '', applicantRealName: '', applicantTitle: '',
  contactPerson: '', contactPhone: '', contactEmail: '', description: '', evidenceNote: '',
}

const relationLabel = (item: OrganizationRelation) => item.memberRole === 'teacher' ? '教师' : item.memberRole === 'school_principal' ? '学校负责人' : item.requestedRole === 'teacher' ? '申请教师' : '学生'

export default function PersonalOrganizationsPage() {
  const toast = useToast()
  const [tab, setTab] = useState('mine')
  const [mine, setMine] = useState<MyOrganizations>({ memberships: [], applications: [], invitations: [] })
  const [organizations, setOrganizations] = useState<OrganizationDirectoryItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<OrganizationDirectoryItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState<{ requestedRole: 'student' | 'teacher'; requestedRelationType: 'enrolled' | 'preselected' | 'employee' | 'external_coach'; realName: string; enrollmentYear: string; title: string; message: string }>({ requestedRole: 'student', requestedRelationType: 'enrolled', realName: '', enrollmentYear: '', title: '', message: '' })
  const [creationApplications, setCreationApplications] = useState<OrganizationCreationApplication[]>([])
  const [creationOpen, setCreationOpen] = useState(false)
  const [creationResult, setCreationResult] = useState<OrganizationCreationApplication | null>(null)
  const [creationForm, setCreationForm] = useState(emptyCreationForm)
  const [creationSubmitting, setCreationSubmitting] = useState(false)

  const loadMine = async () => {
    try { setMine(await getMyOrganizations()) } catch { toast.error('我的学校加载失败') }
  }
  const loadCreationApplications = async () => {
    try { setCreationApplications((await getMyOrganizationCreationApplications()).items) } catch { toast.error('创建申请加载失败') }
  }
  const search = async () => {
    setLoading(true)
    try { setOrganizations((await searchOrganizations(query)).items) }
    catch { toast.error('学校列表加载失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void Promise.all([loadMine(), loadCreationApplications(), search()]) }, [])

  const openCreation = () => {
    setCreationForm(emptyCreationForm)
    setCreationResult(null)
    setCreationOpen(true)
  }
  const submitCreation = async () => {
    const region = [creationForm.province, creationForm.city, creationForm.district].join('/')
    const schoolType = creationForm.schoolType
    if (!creationForm.name.trim() || !schoolType || !creationForm.district || !creationForm.applicantRealName.trim() || creationForm.description.trim().length < 20) {
      return toast.error('请完整填写必填信息，申请说明不少于 20 字')
    }
    setCreationSubmitting(true)
    const response = await createOrganizationApplication({
      organizationType: 'school', ...creationForm, schoolType, region,
    }, createClientUUID())
    setCreationSubmitting(false)
    if (!response.ok) return toast.error(response.error.message || '申请提交失败')
    setCreationResult(response.data)
    await loadCreationApplications()
  }
  const cancelCreation = async (id: string) => {
    const response = await cancelOrganizationApplication(id, createClientUUID())
    if (!response.ok) return toast.error(response.error.message || '撤销失败')
    toast.success('已撤销创建申请')
    await loadCreationApplications()
  }

  const openApplication = (organization: OrganizationDirectoryItem) => {
    setSelected(organization)
    setForm({ requestedRole: 'student', requestedRelationType: 'enrolled', realName: '', enrollmentYear: '', title: '', message: '' })
  }
  const submit = async () => {
    if (!selected || !form.realName.trim()) return
    setSubmitting(true)
    const response = form.requestedRole === 'student'
      ? await createOrganizationJoinApplication({
        organizationId: selected.id, requestedRole: 'student', requestedRelationType: form.requestedRelationType as 'enrolled' | 'preselected',
        realName: form.realName, message: form.message, profileData: { enrollmentYear: Number(form.enrollmentYear) || null },
      })
      : await createOrganizationJoinApplication({
        organizationId: selected.id, requestedRole: 'teacher', requestedRelationType: form.requestedRelationType as 'employee' | 'external_coach',
        realName: form.realName, message: form.message, profileData: { title: form.title },
      })
    setSubmitting(false)
    if (!response.ok) return toast.error(response.error.message || '申请提交失败')
    toast.success('申请已提交，学校审核后会通过站内消息通知你')
    setSelected(null)
    await Promise.all([loadMine(), search()])
  }
  const respond = async (id: string, action: 'accept' | 'decline') => {
    const response = await respondOrganizationInvitation(id, action)
    if (!response.ok) return toast.error(response.error.message || '邀请处理失败')
    toast.success(action === 'accept' ? '已加入学校' : '已拒绝邀请')
    if (action === 'accept' && response.data.organizationId) return window.location.assign(`/org/${response.data.organizationId}/overview`)
    await loadMine()
  }
  const cancel = async (id: string) => {
    const response = await cancelOrganizationJoinApplication(id)
    if (!response.ok) return toast.error(response.error.message || '撤销失败')
    await loadMine()
  }

  const organizationCard = (item: OrganizationDirectoryItem) => {
    const relation = item.relationship
    return <article className={styles.card} key={item.id}>
      <span className={styles.icon}><Building2 size={20} /></span>
      <div className={styles.cardBody}><strong>{item.name}</strong><span>{[item.region?.replaceAll('/', ' · '), item.schoolNature, item.schoolType].filter(Boolean).join(' · ') || '学校资料待完善'}</span></div>
      {!relation && item.joinPolicy === 'approval' && <Button onClick={() => openApplication(item)}>申请加入</Button>}
      {!relation && item.joinPolicy === 'invite_only' && <span className={styles.muted}>仅限邀请</span>}
      {!relation && item.joinPolicy === 'closed' && <span className={styles.muted}>暂不开放</span>}
      {relation?.type === 'membership' && <span className={styles.success}>已加入</span>}
      {relation?.type === 'application' && <span className={styles.pending}>审核中</span>}
      {relation?.type === 'invitation' && <Button variant="secondary" onClick={() => setTab('mine')}>处理邀请</Button>}
    </article>
  }

  return <PageFrame>
    <PageHeader title="我的学校" description="查看已加入的学校、处理邀请或申请加入新学校。">
      <Button onClick={openCreation}>+ 申请创建学校</Button>
    </PageHeader>
    <SegmentedControl label="学校页面" value={tab} onChange={setTab} items={[{ value: 'mine', label: '我的学校' }, { value: 'search', label: '查找学校' }]} />
    {tab === 'mine' ? <div className={styles.sections}>
      {mine.invitations.filter(item => item.status === 'pending').length > 0 && <section><h2>待处理邀请</h2><div className={styles.list}>{mine.invitations.filter(item => item.status === 'pending').map(item => <article className={styles.card} key={item.id}><span className={styles.icon}><Building2 size={20} /></span><div className={styles.cardBody}><strong>{item.Organization.name}</strong><span>邀请你以{relationLabel(item)}身份加入</span></div><div className={styles.actions}><Button variant="secondary" onClick={() => void respond(item.id, 'decline')}>拒绝</Button><Button onClick={() => void respond(item.id, 'accept')}>接受</Button></div></article>)}</div></section>}
      {mine.applications.filter(item => item.status === 'pending').length > 0 && <section><h2>等待审核</h2><div className={styles.list}>{mine.applications.filter(item => item.status === 'pending').map(item => <article className={styles.card} key={item.id}><span className={styles.icon}><Building2 size={20} /></span><div className={styles.cardBody}><strong>{item.Organization.name}</strong><span>{relationLabel(item)} · {new Date(item.createdAt).toLocaleString('zh-CN')}</span></div><span className={styles.pending}>审核中</span><Button variant="secondary" onClick={() => void cancel(item.id)}>撤销申请</Button></article>)}</div></section>}
      {creationApplications.length > 0 && <section><h2>学校创建申请</h2><div className={styles.list}>{creationApplications.map(item => <article className={styles.card} key={item.id}><span className={styles.icon}><Building2 size={20} /></span><div className={styles.cardBody}><strong>{item.name}</strong><span>{item.region.replaceAll('/', ' · ')} · {new Date(item.createdAt).toLocaleString('zh-CN')}{item.status === 'rejected' && item.decisionMessage ? ` · ${item.decisionMessage}` : ''}</span></div><span className={item.status === 'approved' ? styles.success : styles.pending}>{item.status === 'pending' ? '审核中' : item.status === 'approved' ? '已通过 · 已创建' : item.status === 'rejected' ? '已拒绝' : '已撤销'}</span>{item.status === 'pending' && <Button variant="secondary" onClick={() => void cancelCreation(item.id)}>撤销</Button>}{item.status === 'approved' && item.createdOrganizationId && <Button onClick={() => window.location.assign(`/org/${item.createdOrganizationId}/overview`)}>进入学校</Button>}</article>)}</div></section>}
      <section><h2>已加入</h2>{mine.memberships.filter(item => item.status === 'active').length ? <div className={styles.list}>{mine.memberships.filter(item => item.status === 'active').map(item => <article className={styles.card} key={item.id}><span className={styles.icon}><Building2 size={20} /></span><div className={styles.cardBody}><strong>{item.Organization.name}</strong><span>{relationLabel(item)}</span></div><Button onClick={() => window.location.assign(`/org/${item.Organization.id}/overview`)}>进入</Button></article>)}</div> : <Empty title="尚未加入学校" description="你可以查找学校并提交加入申请。" />}</section>
    </div> : <section className={styles.searchSection}>
      <div className={styles.toolbar}><Input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void search() }} placeholder="输入学校名称、简称或地区" aria-label="搜索学校" /><Button icon={<Search size={16} />} onClick={() => void search()}>搜索</Button></div>
      {loading ? <p className={styles.muted}>正在加载学校…</p> : organizations.length ? <div className={styles.list}>{organizations.map(organizationCard)}</div> : <div className={styles.emptyAction}><Empty title="没有找到匹配的学校" description="请确认学校确实不存在，再申请创建。" /><Button variant="secondary" onClick={openCreation}>申请创建学校</Button></div>}
    </section>}
    <FormDialog isOpen={Boolean(selected)} onClose={() => setSelected(null)} onSubmit={() => void submit()} title="申请加入" description={selected?.name} size="md" submitText="提交申请" loading={submitting} dirty={Boolean(form.realName || form.message)}>
      <div className={styles.form}>
        <label>申请身份<Select value={form.requestedRole} onChange={event => { const requestedRole = event.target.value as 'student' | 'teacher'; setForm(current => ({ ...current, requestedRole, requestedRelationType: requestedRole === 'teacher' ? 'employee' : 'enrolled' })) }}><option value="student">学生</option><option value="teacher">教师</option></Select></label>
        <label>真实姓名<Input value={form.realName} onChange={event => setForm(current => ({ ...current, realName: event.target.value }))} maxLength={80} /></label>
        <label>申请类型<Select value={form.requestedRelationType} onChange={event => setForm(current => ({ ...current, requestedRelationType: event.target.value as typeof current.requestedRelationType }))}>{form.requestedRole === 'student' ? <><option value="enrolled">本校学生</option><option value="preselected">预选学生</option></> : <><option value="employee">本校教师</option><option value="external_coach">外聘教练</option></>}</Select></label>
        {form.requestedRole === 'student' ? <label>入学年份<Input inputMode="numeric" value={form.enrollmentYear} onChange={event => setForm(current => ({ ...current, enrollmentYear: event.target.value }))} /></label> : <label>学科 / 职务<Input value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} /></label>}
        <label>申请说明<Textarea value={form.message} onChange={event => setForm(current => ({ ...current, message: event.target.value }))} maxLength={1000} rows={5} /></label>
      </div>
    </FormDialog>
    <FormDialog isOpen={creationOpen} onClose={() => setCreationOpen(false)} onSubmit={creationResult ? undefined : () => void submitCreation()} title="申请创建学校" description="审核通过后，你将成为该学校的负责人。" size="lg" submitText="提交申请" loading={creationSubmitting} dirty={!creationResult && JSON.stringify(creationForm) !== JSON.stringify(emptyCreationForm)} footer={creationResult ? <Button onClick={() => setCreationOpen(false)}>完成</Button> : undefined}>
      {creationResult ? <div className={styles.resultState}><span className={styles.success}>已提交</span><h3>{creationResult.name}</h3><p>申请已保存，超级管理员审核后会通过站内消息通知你。</p></div> : <div className={styles.form}>
        <label>学校正式全称 *<Input value={creationForm.name} onChange={event => setCreationForm(current => ({ ...current, name: event.target.value }))} maxLength={100} /></label>
        <label>学校简称<Input value={creationForm.shortName} onChange={event => setCreationForm(current => ({ ...current, shortName: event.target.value }))} maxLength={30} /></label>
        <label>学校类型 *<Select value={creationForm.schoolType} onChange={event => setCreationForm(current => ({ ...current, schoolType: event.target.value as CreationForm['schoolType'] }))}><option value="">请选择</option>{['小学','初中','高中','小学+初中','初中+高中','小学+初中+高中'].map(value => <option key={value} value={value}>{value}</option>)}</Select></label>
        <label>学校性质<Select value={creationForm.schoolNature} onChange={event => setCreationForm(current => ({ ...current, schoolNature: event.target.value as CreationForm['schoolNature'] }))}><option value="">未选择</option><option value="公办">公办</option><option value="民办">民办</option><option value="其他">其他</option></Select></label>
        <label>学制<Select value={creationForm.educationSystem} onChange={event => setCreationForm(current => ({ ...current, educationSystem: event.target.value as CreationForm['educationSystem'] }))}><option value="6-3-3">6-3-3</option><option value="5-4-3">5-4-3</option></Select></label>
        <label>所在地区 *<RegionSelector province={creationForm.province} city={creationForm.city} district={creationForm.district} onProvinceChange={value => setCreationForm(current => ({ ...current, province: value }))} onCityChange={value => setCreationForm(current => ({ ...current, city: value }))} onDistrictChange={value => setCreationForm(current => ({ ...current, district: value }))} /></label>
        <label>负责人真实姓名 *<Input value={creationForm.applicantRealName} onChange={event => setCreationForm(current => ({ ...current, applicantRealName: event.target.value }))} maxLength={80} /></label>
        <label>职务<Input value={creationForm.applicantTitle} onChange={event => setCreationForm(current => ({ ...current, applicantTitle: event.target.value }))} maxLength={80} /></label>
        <label>联系人<Input value={creationForm.contactPerson} onChange={event => setCreationForm(current => ({ ...current, contactPerson: event.target.value }))} maxLength={80} /></label>
        <label>联系电话<Input value={creationForm.contactPhone} onChange={event => setCreationForm(current => ({ ...current, contactPhone: event.target.value }))} maxLength={30} /></label>
        <label>联系邮箱<Input type="email" value={creationForm.contactEmail} onChange={event => setCreationForm(current => ({ ...current, contactEmail: event.target.value }))} maxLength={160} /></label>
        <label>申请说明 *<Textarea value={creationForm.description} onChange={event => setCreationForm(current => ({ ...current, description: event.target.value }))} minLength={20} maxLength={2000} rows={6} placeholder="说明创建该学校的原因和使用计划（不少于 20 字）" /></label>
        <label>证明说明<Textarea value={creationForm.evidenceNote} onChange={event => setCreationForm(current => ({ ...current, evidenceNote: event.target.value }))} maxLength={2000} rows={4} placeholder="可选，请填写可供审核的文字说明" /></label>
      </div>}
    </FormDialog>
  </PageFrame>
}
