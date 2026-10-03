'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useCallback, useEffect, useState } from 'react'
import { Database, FileKey2, Plus, RefreshCw, ShieldAlert } from 'lucide-react'
import { createClientUUID } from '@/lib/uuid'
import { useAuth } from '@/features/auth'
import { useToast } from '@/components/ui/Toast'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { FormDialog, DetailDialog } from '@/components/ui/Dialogs'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { ProblemSlotPicker, LicenseScopePicker } from './DataMarketResourcePickers'
import styles from './DataMarketplace.module.css'
import { buildDataPurchasePayload, canManageDataMarketplace, type DataLicense } from '../model/data-market'
import { confirmQualityIncident, createDataProduct as createDataProductRequest, createQualityIncident as createQualityIncidentRequest, getEntitlementManifest, listDataEntitlements, listDataProducts, listQualityIncidents, purchaseDataProduct, resolveQualityIncident } from '../api/dataMarketApi'
import type { DataEntitlement as Entitlement, DataProduct as Product, TestSetQualityIncident as Incident } from '@oi-manager/contracts'

type Price = { id: string; licenseType: DataLicense; amountCarits: string }
type Certificate = { overallScore: number; correctnessScore: number; discriminationScore: number; coverageScore: number; confidenceLevel: string; maturityLevel: string }
const licenseLabel = { PERSONAL: '个人', ORGANIZATION: '学校', CONTEST: '比赛' }
const gradeLabel: Record<string, string> = { COMMUNITY: '社区级', VERIFIED: '已验证', COMPETITION_GRADE: '竞赛级' }
const qualityConclusion = (score: number | null) => (score ?? 0) >= 85 ? '质量优秀' : (score ?? 0) >= 70 ? '质量良好' : '基础可用'
const dataSetLabel = (slot: string) => slot === 'STABLE' ? '正式评测数据' : slot === 'EVOLVING' ? '当前评测数据' : '评测数据待确认'
const licenseTypeLabel = (value: string) => licenseLabel[value as keyof typeof licenseLabel] || '授权范围待确认'
const incidentSeverityLabel = (value: string) => ({ INFO: '提示', MINOR: '轻微', MAJOR: '重要', CRITICAL: '严重' }[value] || '程度待确认')
const incidentStatusLabel = (value: string) => ({ OPEN: '待确认', CONFIRMED: '处理中', RESOLVED: '已解决' }[value] || '状态待确认')
const confidenceLabel = (value: string) => ({ HIGH: '高', MEDIUM: '中', LOW: '低' }[value] || '待确认')

function ManifestSummary({ value }: { value: unknown }) {
  const manifest = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const problem = manifest.problem && typeof manifest.problem === 'object' ? manifest.problem as Record<string, unknown> : {}
  const testSet = manifest.testSet && typeof manifest.testSet === 'object' ? manifest.testSet as Record<string, unknown> : {}
  const includes = manifest.includes && typeof manifest.includes === 'object' ? manifest.includes as Record<string, unknown> : {}
  const cases = Array.isArray(manifest.cases) ? manifest.cases as Array<Record<string, unknown>> : []
  return <div className={styles.form}>
    <dl>
      <div><dt>题目</dt><dd>{String(problem.problemId || '')} · {String(problem.title || '题目')}</dd></div>
      <div><dt>授权范围</dt><dd>{licenseTypeLabel(String(manifest.licenseType || ''))}</dd></div>
      <div><dt>评测数据</dt><dd>{dataSetLabel(String(testSet.slot || ''))}</dd></div>
      <div><dt>内容</dt><dd>{includes.testdata ? `${cases.length} 组测试数据` : '不含测试数据'}{includes.checker ? ' · 包含答案校验配置' : ''}</dd></div>
    </dl>
    {cases.length > 0 && <details><summary>下载测试数据（{cases.length}）</summary>{cases.map((item, index) => {
      const input = item.input && typeof item.input === 'object' ? item.input as Record<string, unknown> : {}
      const output = item.output && typeof item.output === 'object' ? item.output as Record<string, unknown> : {}
      return <p key={index}>第 {index + 1} 组：<a href={String(input.downloadHref || '#')}>{String(item.inputName || '输入')}</a> · <a href={String(output.downloadHref || '#')}>{String(item.outputName || '答案')}</a></p>
    })}</details>}
  </div>
}

export function DataMarketplace() {
  const { user } = useAuth(), toast = useToast()
  const [tab, setTab] = useState<'market' | 'owned' | 'manage'>('market')
  const [products, setProducts] = useState<Product[]>([]), [entitlements, setEntitlements] = useState<Entitlement[]>([])
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Product | null>(null), [buying, setBuying] = useState<Product | null>(null)
  const [license, setLicense] = useState<Price['licenseType']>('PERSONAL'), [organizationId, setOrganizationId] = useState(''), [contestId, setContestId] = useState('')
  const [manifest, setManifest] = useState<unknown>(null), [manifestTitle, setManifestTitle] = useState('')
  const [publishOpen, setPublishOpen] = useState(false), [publish, setPublish] = useState({ problemId: '', slot: 'STABLE' as 'STABLE' | 'EVOLVING', qualitySnapshotId: '', updatePolicy: 'SNAPSHOT' })
  const [incidentOpen, setIncidentOpen] = useState(false), [incidentProblemId, setIncidentProblemId] = useState('')
  const [incident, setIncident] = useState({ slot: 'STABLE' as 'STABLE' | 'EVOLVING', severity: 'CRITICAL', type: '', description: '' })
  const [incidents, setIncidents] = useState<Incident[]>([])
  const canManage = canManageDataMarketplace(user?.accountRole, user?.organizationRole)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [productsResult, entitlementsResult] = await Promise.allSettled([
        listDataProducts(),
        listDataEntitlements(),
      ])
      if (productsResult.status === 'fulfilled') setProducts(productsResult.value)
      if (entitlementsResult.status === 'fulfilled') setEntitlements(entitlementsResult.value)
      const failures = [productsResult, entitlementsResult].filter(result => result.status === 'rejected')
      if (failures.length === 2) toast.error('数据商品和授权均加载失败，请稍后重试')
      else if (productsResult.status === 'rejected') toast.warning('数据商品加载失败，已保留你的授权列表')
      else if (entitlementsResult.status === 'rejected') toast.warning('授权列表加载失败，数据商品仍可浏览')
    } finally {
      setLoading(false)
    }
  }, [toast])
  useEffect(() => { void load() }, [load])

  const buy = async () => { if (!buying) return; setBusy(true); const result = await purchaseDataProduct(buying.id, buildDataPurchasePayload(license, organizationId, contestId), createClientUUID()); setBusy(false); if (!result.ok) return toast.error(result.error.userMessage); toast.success('购买成功，评测数据授权已生成'); setBuying(null); await load() }
  const createProduct = async () => { if (!publish.problemId || !publish.slot || !publish.qualitySnapshotId) return toast.warning('请选择有可用质量证书的评测数据'); setBusy(true); const result = await createDataProductRequest(publish.problemId, { slot: publish.slot, qualitySnapshotId: publish.qualitySnapshotId, updatePolicy: publish.updatePolicy as 'SNAPSHOT' | 'UPDATE_90D' | 'LIFETIME_UPDATES', allowedLicenses: ['PERSONAL', 'ORGANIZATION', 'CONTEST'], includes: { testdata: true, checker: true } }); setBusy(false); if (!result.ok) return toast.error(result.error.userMessage); toast.success('商品已按质量证书自动定级定价'); setPublishOpen(false); await load() }
  const loadIncidents = async (id = incidentProblemId) => { if (!id) return toast.warning('请先选择题目'); setBusy(true); try { setIncidents(await listQualityIncidents(id)) } catch (error) { toast.error(publicErrorMessage(error, '读取事故失败')) } finally { setBusy(false) } }
  const createIncident = async () => { if (!incident.slot) return toast.warning('请先选择评测数据'); setBusy(true); const result = await createQualityIncidentRequest({ problemId: incidentProblemId, ...incident, severity: incident.severity as 'INFO' | 'MINOR' | 'MAJOR' | 'CRITICAL', evidence: { reportedFrom: 'data-market-web' } }); setBusy(false); if (!result.ok) return toast.error(result.error.userMessage); toast.success('质量事故已登记'); setIncidentOpen(false); setIncidentProblemId(result.data.problemId); await loadIncidents(result.data.problemId); await load() }
  const incidentAction = async (id: string, action: 'confirm' | 'resolve') => { setBusy(true); const result = action === 'confirm' ? await confirmQualityIncident(id) : await resolveQualityIncident(id, {}); setBusy(false); if (!result.ok) return toast.error(result.error.userMessage); toast.success(action === 'confirm' ? '事故已确认' : '事故已解决'); await loadIncidents() }
  const viewManifest = async (item: Entitlement) => { setBusy(true); try { setManifest(await getEntitlementManifest(item.id)); setManifestTitle(`${item.Purchase.Product.Problem.title} · ${dataSetLabel(item.Purchase.Product.slot)}`) } catch (error) { toast.error(publicErrorMessage(error, '读取授权清单失败')) } finally { setBusy(false) } }

  return <PageFrame width="workbench"><PageHeader title="题目数据市场" description="购买经质量检查的评测数据授权。" actions={<Button variant="outline" icon={<RefreshCw size={16}/>} onClick={() => void load()}>刷新</Button>}/>
    <div className={styles.tabs}><Button variant={tab === 'market' ? 'primary' : 'ghost'} onClick={() => setTab('market')}>数据商品</Button><Button variant={tab === 'owned' ? 'primary' : 'ghost'} onClick={() => setTab('owned')}>我的授权</Button>{canManage && <Button variant={tab === 'manage' ? 'primary' : 'ghost'} onClick={() => setTab('manage')}>发布与质量事故</Button>}</div>
    {loading ? <div className={styles.empty}>正在加载…</div> : tab === 'market' ? <div className={styles.grid}>{products.length ? products.map(product => <article className={styles.card} key={product.id}><div className={styles.badges}><Badge variant="success">{gradeLabel[product.grade] || '等级待确认'}</Badge><Badge variant="neutral">{qualityConclusion(product.QualitySnapshot.overallScore)}</Badge></div><h2>{product.Problem.title}</h2><p className={styles.muted}>{product.Problem.problemId} · 已通过平台质量检查</p><div className={styles.actions}>{product.Prices.map(price => <Button size="sm" key={price.id} onClick={() => { setBuying(product); setLicense(price.licenseType); setOrganizationId(''); setContestId('') }}>{licenseLabel[price.licenseType]} {price.amountCarits} C</Button>)}<Button size="sm" variant="outline" onClick={() => setSelected(product)}>查看质量报告</Button></div></article>) : <div className={styles.empty}>暂无可售数据商品</div>}</div>
    : tab === 'owned' ? <div className={styles.grid}>{entitlements.length ? entitlements.map(item => <article className={styles.card} key={item.id}><Badge>{licenseTypeLabel(item.licenseType)}</Badge><h2>{item.Purchase.Product.Problem.title}</h2><div className={styles.revision}><strong>已授权 {dataSetLabel(item.Purchase.Product.slot)}</strong><p className={styles.muted}>可按授权清单下载</p><Button size="sm" variant="outline" icon={<FileKey2 size={14}/>} onClick={() => void viewManifest(item)}>授权清单与下载</Button></div></article>) : <div className={styles.empty}>尚未购买数据授权</div>}</div>
    : <div className={styles.grid}><section className={styles.panel}><Database/><h2>发布数据商品</h2><p>直接从已完成质量检查的题目中选择。</p><Button icon={<Plus size={16}/>} onClick={() => setPublishOpen(true)}>发布商品</Button></section><section className={styles.panel}><ShieldAlert/><h2>登记质量事故</h2><Button variant="danger" onClick={() => setIncidentOpen(true)}>登记事故</Button></section><section className={`${styles.panel} ${styles.wide}`}><h2>事故状态与修复</h2><ProblemSlotPicker problemId={incidentProblemId} slot={incident.slot} onProblemChange={setIncidentProblemId} onSlotChange={slot => setIncident(value => ({ ...value, slot: slot as 'STABLE' | 'EVOLVING' }))}/><Button variant="outline" disabled={!incidentProblemId} onClick={() => void loadIncidents()}>查询事故</Button>{incidents.map(item => <div className={styles.revision} key={item.id}><Badge variant={item.severity === 'CRITICAL' ? 'error' : 'neutral'}>{incidentSeverityLabel(item.severity)}</Badge><strong>{item.type || '质量问题'}</strong><span>{incidentStatusLabel(item.status)}</span><p>{item.description}</p>{item.status === 'OPEN' && <Button size="sm" onClick={() => void incidentAction(item.id, 'confirm')}>确认事故</Button>}{item.status !== 'RESOLVED' && <div className={styles.actions}><Button size="sm" onClick={() => void incidentAction(item.id, 'resolve')}>解决事故</Button></div>}</div>)}</section></div>}

    <DetailDialog isOpen={Boolean(selected)} onClose={() => setSelected(null)} title="数据质量报告">{selected && <><h3>{selected.Problem.title} · {qualityConclusion(selected.QualitySnapshot.overallScore)}</h3><p>该数据已经完成正确性、覆盖和区分能力检查。</p><details><summary>查看技术证书与评分细项</summary><div className={styles.certificate}><div><strong>{selected.QualitySnapshot.overallScore}/100</strong><span>综合评分</span></div><div><strong>{selected.QualitySnapshot.correctnessScore}/30</strong><span>正确性</span></div><div><strong>{selected.QualitySnapshot.discriminationScore}/25</strong><span>区分能力</span></div><div><strong>{selected.QualitySnapshot.coverageScore}/15</strong><span>覆盖</span></div><div><strong>{confidenceLabel(selected.QualitySnapshot.confidenceLevel)}</strong><span>依据充足度</span></div></div></details></>}</DetailDialog>
    <FormDialog isOpen={Boolean(buying)} onClose={() => setBuying(null)} onSubmit={() => void buy()} title="购买当前数据授权" submitText="确认购买" loading={busy}><div className={styles.form}><label>使用范围<Select value={license} onChange={e => { setLicense(e.target.value as DataLicense); setOrganizationId(''); setContestId('') }}>{buying?.Prices.map(p => <option key={p.id} value={p.licenseType}>{licenseLabel[p.licenseType]} · {p.amountCarits} C</option>)}</Select></label><LicenseScopePicker license={license} organizationId={organizationId} contestId={contestId} onOrganizationChange={setOrganizationId} onContestChange={setContestId}/></div></FormDialog>
    <FormDialog isOpen={publishOpen} onClose={() => setPublishOpen(false)} onSubmit={() => void createProduct()} title="发布质量认证数据" submitText="发布" loading={busy} size="lg"><div className={styles.form}><ProblemSlotPicker problemId={publish.problemId} slot={publish.slot} onProblemChange={id => setPublish(v => ({ ...v, problemId: id, qualitySnapshotId: '' }))} onSlotChange={slot => setPublish(v => ({ ...v, slot: slot as 'STABLE' | 'EVOLVING', qualitySnapshotId: '' }))} onQualityChange={id => setPublish(v => ({ ...v, qualitySnapshotId: id }))} requireQuality/><label>更新策略<Select value={publish.updatePolicy} onChange={e => setPublish(v => ({ ...v, updatePolicy: e.target.value }))}><option value="SNAPSHOT">固定当前内容</option><option value="UPDATE_90D">90 天更新</option><option value="LIFETIME_UPDATES">永久更新</option></Select></label></div></FormDialog>
    <FormDialog isOpen={incidentOpen} onClose={() => setIncidentOpen(false)} onSubmit={() => void createIncident()} title="登记测试数据质量事故" submitText="登记" danger={incident.severity === 'CRITICAL'} loading={busy} size="lg"><div className={styles.form}><ProblemSlotPicker problemId={incidentProblemId} slot={incident.slot} onProblemChange={setIncidentProblemId} onSlotChange={slot => setIncident(v => ({ ...v, slot: slot as 'STABLE' | 'EVOLVING' }))}/><label>严重程度<Select value={incident.severity} onChange={e => setIncident(v => ({ ...v, severity: e.target.value }))}><option value="INFO">提示</option><option value="MINOR">轻微</option><option value="MAJOR">重要</option><option value="CRITICAL">严重（立即停售）</option></Select></label><label>问题类型<Input value={incident.type} onChange={e => setIncident(v => ({ ...v, type: e.target.value }))}/></label><label>影响说明<Textarea rows={5} value={incident.description} onChange={e => setIncident(v => ({ ...v, description: e.target.value }))}/></label></div></FormDialog>
    <DetailDialog isOpen={manifest !== null} onClose={() => setManifest(null)} title="授权数据清单" description={manifestTitle}>{manifest !== null && <ManifestSummary value={manifest} />}</DetailDialog>
  </PageFrame>
}
