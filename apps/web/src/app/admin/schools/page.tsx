'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { apiClient } from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Pagination } from '@/components/ui/Pagination'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useSchools } from '@/hooks/data/useSchools'
import { useAuth } from '@/components/AuthProvider'
import { ActionMenu, ActionMenuItem } from '@/components/management/ManagementList'
import { useToast } from '@/components/ui/Toast'
import unifiedStyles from './page.unified.module.css'
import styles from './page.module.css'

type Application = {
  id:string; name:string; region:string; schoolType:string; schoolNature?:string|null; educationSystem:string
  applicantRealName:string; applicantTitle?:string|null; contactPerson?:string|null; contactPhone?:string|null
  contactEmail?:string|null; description:string; evidenceData?:{note?:string}|null
  status:'pending'|'approved'|'rejected'|'cancelled'; decisionMessage?:string|null; internalReviewNote?:string|null
  createdAt:string; Applicant:{username:string;status:string}
}
type ApplicationPage = { items:Application[]; total:number; pending:number }
const labels = { pending:'待审核', approved:'已通过', rejected:'已拒绝', cancelled:'已撤销' }

export default function AdminSchoolsPage() {
  const { sessionKey } = useAuth()
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams(); const toast = useToast()
  const tab = params.get('tab') === 'applications' ? 'applications' : 'schools'
  const [page,setPage] = useState(Number(params.get('page')) || 1); const [pageSize,setPageSize] = useState(20)
  const [status,setStatus] = useState(params.get('status') || 'pending'); const [query,setQuery] = useState(params.get('q') || '')
  const [applications,setApplications] = useState<Application[]>([]); const [applicationTotal,setApplicationTotal] = useState(0)
  const [pending,setPending] = useState(0); const [applicationLoading,setApplicationLoading] = useState(false)
  const [selected,setSelected] = useState<Application|null>(null); const [decision,setDecision] = useState(''); const [note,setNote] = useState(''); const [reviewing,setReviewing] = useState(false)
  const { data, loading, error } = useSchools({ page, pageSize }, sessionKey)
  const setUrl = useCallback((next:Record<string,string|null>) => { const search = new URLSearchParams(params.toString()); Object.entries(next).forEach(([key,value]) => value ? search.set(key,value) : search.delete(key)); router.replace(`${pathname}?${search}`) },[params,pathname,router])
  const loadApplications = useCallback(async () => { setApplicationLoading(true); const response = await apiClient.get<ApplicationPage>(`/api/platform/organization-creation-applications?status=${encodeURIComponent(status)}&q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`); setApplicationLoading(false); if (!response.success || !response.data) return toast.error(response.message || '加载失败'); setApplications(response.data.items); setApplicationTotal(response.data.total); setPending(response.data.pending) },[page,pageSize,query,status,toast])
  useEffect(() => { if (tab === 'applications') void loadApplications() },[loadApplications,tab])
  useEffect(() => { if (tab === 'schools') void apiClient.get<ApplicationPage>('/api/platform/organization-creation-applications?status=pending&pageSize=1').then(response => setPending(response.data?.pending || 0)) },[tab])
  useEffect(() => { const id=params.get('applicationId'); if (!id || tab !== 'applications') return; void apiClient.get<Application>(`/api/platform/organization-creation-applications/${id}`).then(r => { if (r.success && r.data) openReview(r.data) }) },[params,tab])
  const openReview = (item:Application) => { setSelected(item); setDecision(item.decisionMessage || ''); setNote(item.internalReviewNote || ''); if (params.get('applicationId') !== item.id) setUrl({applicationId:item.id}) }
  const closeReview = () => { setSelected(null); setUrl({applicationId:null}) }
  const review = async (action:'approve'|'reject') => { if (!selected) return; if (action === 'reject' && !decision.trim()) return toast.error('请填写申请人可见的拒绝说明'); setReviewing(true); const response=await apiClient.post(`/api/platform/organization-creation-applications/${selected.id}/${action}`,{decisionMessage:decision,internalReviewNote:note},{headers:{'Idempotency-Key':crypto.randomUUID()}}); setReviewing(false); if(!response.success)return toast.error(response.message||'审核失败'); toast.success(action==='approve'?'已同意并创建学校':'已拒绝申请'); closeReview(); await loadApplications() }
  const total = tab === 'schools' ? data?.total || 0 : applicationTotal; const totalPages=Math.ceil(total/pageSize)
  const changeTab=(value:string)=>{setPage(1);setUrl({tab:value==='applications'?'applications':null,page:null,applicationId:null})}
  return <div className={unifiedStyles.u1}><main className={unifiedStyles.u2}>
    <PageHeader title="学校管理"><Button onClick={()=>router.push('/admin/schools/new')}>+ 直接创建学校</Button></PageHeader>
    <SegmentedControl label="学校管理页面" value={tab} onChange={changeTab} items={[{value:'schools',label:'学校列表'},{value:'applications',label:`创建申请${pending?` ${pending}`:''}`}]}/>
    {tab==='schools' ? error ? <div className={unifiedStyles.u3}>{error}</div> : <Table data={data?.data||[]} loading={loading} emptyText="暂无学校数据" columns={[
      {key:'name',label:'学校名称'},{key:'schoolType',label:'类型',render:s=>s.schoolType||'-'},{key:'region',label:'区域',render:s=>s.region||'-'},
      {key:'principal',label:'负责人',render:s=>s.principal?s.principal.name:<span className={unifiedStyles.u4}>待指派</span>},{key:'contactPerson',label:'联系人',render:s=>s.contactPerson||'-'},
      {key:'status',label:'状态',render:s=><Badge variant={s.status==='active'?'success':'error'}>{s.status==='active'?'正常':'禁用'}</Badge>}
    ]} actions={s=><><Link href={`/admin/schools/${s.id}`} className={unifiedStyles.u5}>查看</Link><ActionMenu><ActionMenuItem onClick={()=>router.push(`/admin/schools/${s.id}/edit`)}>编辑学校</ActionMenuItem></ActionMenu></>}/>:<>
      <div className={styles.filters}><Select aria-label="申请状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);setUrl({status:e.target.value,page:null})}}><option value="pending">待审核</option><option value="approved">已通过</option><option value="rejected">已拒绝</option><option value="cancelled">已撤销</option></Select><Input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){setUrl({q:query||null,page:null});void loadApplications()}}} placeholder="搜索学校、申请人或用户名"/><Button onClick={()=>{setUrl({q:query||null,page:null});void loadApplications()}}>搜索</Button></div>
      <Table data={applications} loading={applicationLoading} emptyText="暂无符合条件的创建申请" columns={[
        {key:'name',label:'学校名称'},{key:'applicantRealName',label:'申请人',render:i=>`${i.applicantRealName} (${i.Applicant.username})`},{key:'region',label:'地区',render:i=>i.region.replaceAll('/',' · ')},{key:'schoolType',label:'类型'},
        {key:'status',label:'状态',render:i=><Badge variant={i.status==='approved'?'success':i.status==='rejected'?'error':'neutral'}>{labels[i.status]}</Badge>},{key:'createdAt',label:'提交时间',render:i=>new Date(i.createdAt).toLocaleString('zh-CN')}
      ]} actions={i=><Button variant="secondary" size="sm" onClick={()=>openReview(i)}>{i.status==='pending'?'审核':'查看'}</Button>}/>
    </>}
    {totalPages>0&&<Pagination currentPage={page} totalPages={totalPages} total={total} pageSize={pageSize} onPageChange={v=>{setPage(v);setUrl({page:String(v)})}} onPageSizeChange={v=>{setPageSize(v);setPage(1)}} pageSizeOptions={[10,20,50,100]} showTotal showQuickJumper/>}
    <FormDialog isOpen={Boolean(selected)} onClose={closeReview} title={selected?.status==='pending'?'审核组织创建申请':'查看组织创建申请'} description={selected?.name} size="lg" loading={reviewing} dirty={Boolean(selected?.status==='pending'&&(decision||note))} footer={selected?.status==='pending'?<><Button variant="secondary" onClick={closeReview} disabled={reviewing}>取消</Button><Button variant="danger" onClick={()=>void review('reject')} disabled={reviewing}>拒绝申请</Button><Button onClick={()=>void review('approve')} loading={reviewing}>同意并创建学校</Button></>:<Button onClick={closeReview}>关闭</Button>}>
      {selected&&<div className={styles.review}><dl><dt>申请账号</dt><dd>{selected.Applicant.username} · {selected.Applicant.status}</dd><dt>负责人</dt><dd>{selected.applicantRealName}{selected.applicantTitle?` · ${selected.applicantTitle}`:''}</dd><dt>学校资料</dt><dd>{selected.schoolType} · {selected.region.replaceAll('/',' · ')}{selected.schoolNature?` · ${selected.schoolNature}`:''} · {selected.educationSystem}</dd><dt>联系方式</dt><dd>{[selected.contactPerson,selected.contactPhone,selected.contactEmail].filter(Boolean).join(' · ')||'未填写'}</dd><dt>申请说明</dt><dd>{selected.description}</dd><dt>证明说明</dt><dd>{selected.evidenceData?.note||'未填写'}</dd></dl>{selected.status==='pending'?<><label>申请人可见说明<Textarea value={decision} onChange={e=>setDecision(e.target.value)} rows={3} maxLength={1000}/></label><label>内部审核备注<Textarea value={note} onChange={e=>setNote(e.target.value)} rows={3} maxLength={2000}/></label></>:<><p><strong>审核结果：</strong>{labels[selected.status]}</p>{selected.decisionMessage&&<p><strong>审核说明：</strong>{selected.decisionMessage}</p>}{selected.internalReviewNote&&<p><strong>内部备注：</strong>{selected.internalReviewNote}</p>}</>}</div>}
    </FormDialog>
  </main></div>
}
