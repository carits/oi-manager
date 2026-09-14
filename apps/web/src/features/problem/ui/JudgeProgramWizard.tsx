'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, RotateCcw, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { FormDialog } from '@/components/ui/Dialogs'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import styles from './JudgeProgramWizard.module.css'
import type { GeneratorProtocolConfig as ProtocolConfig, JudgeProgramFixture as Fixture, JudgeProgramKind as Kind, ParameterRule, ProgramCatalog, ProgramTemplate } from '../model/judgeProgramTemplateTypes'
import { getJudgeProgramTemplate } from '../api/judgeProgramTemplateApi'

type Draft = { id: string; kind: Kind; name: string; language: string; protocol: string; templateId?: string; templateVersion?: number; source: string; protocolConfig?: ProtocolConfig; fixtures: Fixture[]; revision: number }
type Program = { id: string; kind: Kind; name: string; currentVersionId?: string | null; versions: Array<{ id: string; versionNumber: number; lifecycleStatus: string; compileStatus: string }> }
type Verification = { id: string; status: string; mode: string; report?: { fixtures?: Array<{ name: string; passed: boolean; message: string; timeMs: number; memoryKb: number; stdoutPreview?: string; stderrPreview?: string }>; warnings?: string[] }; errorCode?: string; errorMessage?: string }
type CreatedProgramVersion = { program: Program; version: { id: string } }
type IdPayload = { id: string }

const DEFAULT_DSL = JSON.stringify({ version: 1, input: [{ type: 'int', name: 'n', min: 1, max: 200000 }, { type: 'array', name: 'a', length: 'n', element: { min: -1000000000, max: 1000000000 } }], assertions: [], strictEof: true }, null, 2)
const DEFAULT_CONFIG: ProtocolConfig = { profiles: [{ id: 'default', label: '默认', params: {} }], parameterSchema: {} }
const STEPS = ['职责', '创建方式', '源码与协议', '测试程序', '验证与激活']

function downloadSource(name: string, language: string, source: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }))
  link.download = `${name || 'program'}.${language === 'python3' ? 'py' : language === 'validator-dsl' ? 'json' : 'cpp'}`
  link.click(); URL.revokeObjectURL(link.href)
}

function languageLabel(language: string) { return language === 'python3' ? 'Python3' : language === 'validator-dsl' ? 'Validator DSL' : 'C++17' }
const cloneConfig = (value?: ProtocolConfig) => value ? JSON.parse(JSON.stringify(value)) as ProtocolConfig : DEFAULT_CONFIG
const cloneFixtures = (value: Fixture[]) => JSON.parse(JSON.stringify(value)) as Fixture[]

export function JudgeProgramWizard({ open, onClose, initialTemplateId, problemId, judgeMode, catalog, subtasks, onChanged }: { open: boolean; onClose: () => void; initialTemplateId?: string | null; problemId: string; judgeMode: 'acm' | 'oi'; catalog: ProgramCatalog | null; subtasks: Array<{ id: number; score?: number; dependencies?: number[] }>; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const [step, setStep] = useState(0), [kind, setKind] = useState<Kind>('standard'), [method, setMethod] = useState<'code' | 'dsl'>('code')
  const [name, setName] = useState(''), [language, setLanguage] = useState('cpp17'), [protocol, setProtocol] = useState('oj.standard/v1'), [templateId, setTemplateId] = useState(''), [source, setSource] = useState('')
  const [fixtures, setFixtures] = useState<Fixture[]>([]), [protocolConfig, setProtocolConfig] = useState<ProtocolConfig>(DEFAULT_CONFIG)
  const [draft, setDraft] = useState<Draft | null>(null), [program, setProgram] = useState<Program | null>(null), [versionId, setVersionId] = useState(''), [verification, setVerification] = useState<Verification | null>(null)
  const [busy, setBusy] = useState(false), [protocolOpen, setProtocolOpen] = useState(false)
  const [loadedTemplate, setLoadedTemplate] = useState<ProgramTemplate | null>(null), [previewTemplate, setPreviewTemplate] = useState<ProgramTemplate | null>(null)
  const [blankChosen, setBlankChosen] = useState(false)
  const templates = useMemo(() => catalog?.templates.filter(item => item.kind === kind) || [], [catalog, kind])
  const selectedTemplate = loadedTemplate?.id === templateId ? loadedTemplate : null
  const selectedTemplateVersion = draft?.templateId === templateId ? draft.templateVersion : selectedTemplate?.version

  const loadTemplate = useCallback(async (id: string) => {
    try {
      const result = await getJudgeProgramTemplate(id)
      setKind(result.kind); setMethod(result.language === 'validator-dsl' ? 'dsl' : 'code'); setTemplateId(id); setLanguage(result.language); setProtocol(result.protocol); setName(result.title); setSource(result.source || ''); setFixtures(cloneFixtures(result.examples || [])); setProtocolConfig(cloneConfig(result.protocolConfig)); setLoadedTemplate(result); setPreviewTemplate(null); setBlankChosen(false); setDraft(null); setProgram(null); setVersionId(''); setVerification(null)
    } catch { toast.error('模板加载失败') }
  }, [toast])

  const previewTemplateById = useCallback(async (id: string) => {
    try { setPreviewTemplate(await getJudgeProgramTemplate(id)) }
    catch { toast.error('模板预览加载失败') }
  }, [toast])

  const selectKind = useCallback((next: Kind) => {
    const defaultLanguage = catalog?.capabilities[next]?.defaultLanguage || 'cpp17'
    const defaultProtocol = catalog?.capabilities[next]?.languages[defaultLanguage]?.[0] || `oj.${next}/v1`
    setKind(next); setMethod(defaultLanguage === 'validator-dsl' ? 'dsl' : 'code'); setName(''); setLanguage(defaultLanguage); setProtocol(defaultProtocol); setTemplateId(''); setSource(''); setFixtures([]); setProtocolConfig(cloneConfig()); setLoadedTemplate(null); setPreviewTemplate(null); setBlankChosen(false); setDraft(null); setProgram(null); setVersionId(''); setVerification(null)
  }, [catalog])

  useEffect(() => {
    if (!open || !catalog) return
    setStep(initialTemplateId ? 1 : 0)
    if (initialTemplateId) { void loadTemplate(initialTemplateId); return }
    void apiClient.get<Draft[]>(`/api/problems/${problemId}/judge-program-drafts`).then(result => {
      const existing = result.data?.find(item => item.kind === 'standard')
      if (existing) {
        setKind(existing.kind); setDraft(existing); setName(existing.name); setLanguage(existing.language); setProtocol(existing.protocol); setTemplateId(existing.templateId || ''); setSource(existing.source); setFixtures(existing.fixtures || []); setProtocolConfig(existing.protocolConfig || DEFAULT_CONFIG); setLoadedTemplate(null); setBlankChosen(!existing.templateId)
        if (existing.templateId) void getJudgeProgramTemplate(existing.templateId).then(setLoadedTemplate).catch(() => undefined)
      }
      else selectKind('standard')
    })
  }, [open, catalog, problemId, initialTemplateId, loadTemplate, selectKind])

  useEffect(() => {
    if (!open || !source.trim() || method === 'dsl') return
    const timer = window.setTimeout(async () => {
      const result = await apiClient.post<Draft>(`/api/problems/${problemId}/judge-program-drafts`, { kind, name: name || catalog?.capabilities[kind]?.title, language, protocol, templateId, templateVersion: selectedTemplateVersion, source, fixtures, protocolConfig, expectedRevision: draft?.revision })
      if (result.success && result.data) setDraft(result.data)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [open, kind, name, language, protocol, templateId, source, fixtures, protocolConfig, method])

  useEffect(() => {
    if (!program || !versionId || !verification || !['queued', 'running'].includes(verification.status)) return
    const timer = window.setInterval(async () => {
      const result = await apiClient.get<Verification[]>(`/api/problems/${problemId}/judge-programs/${program.id}/versions/${versionId}/verification`)
      const latest = result.data?.[0]
      if (latest) setVerification(latest)
      if (latest && !['queued', 'running'].includes(latest.status)) await onChanged()
    }, 1200)
    return () => window.clearInterval(timer)
  }, [program, versionId, verification?.status, problemId, onChanged])

  const switchLanguage = (next: string) => {
    if (source.trim() && next !== language && !window.confirm('切换语言会清空当前编辑内容，已有代码草稿仍保存在服务端。确定切换吗？')) return
    setLanguage(next); setMethod(next === 'validator-dsl' ? 'dsl' : 'code'); setProtocol(catalog?.capabilities[kind]?.languages[next]?.[0] || protocol); setTemplateId(''); setLoadedTemplate(null); setSource(next === 'validator-dsl' ? DEFAULT_DSL : ''); setFixtures([]); setProtocolConfig(cloneConfig()); setBlankChosen(true)
  }
  const chooseTemplate = (id: string) => {
    const hasContent = Boolean(source.trim() || fixtures.length)
    const modifiedCurrentTemplate = Boolean(selectedTemplate && (source !== selectedTemplate.source || JSON.stringify(fixtures) !== JSON.stringify(selectedTemplate.examples) || JSON.stringify(protocolConfig) !== JSON.stringify(selectedTemplate.protocolConfig || DEFAULT_CONFIG)))
    if ((id !== templateId && hasContent) || modifiedCurrentTemplate) {
      if (!window.confirm('使用其他模板会替换当前源码、Fixture 和 Generator 配置。已有代码草稿仍保存在服务端，确定继续吗？')) return
    }
    void loadTemplate(id)
  }
  const startBlank = () => { setTemplateId(''); setLoadedTemplate(null); setPreviewTemplate(null); setName(''); setSource(language === 'validator-dsl' ? DEFAULT_DSL : ''); setFixtures([]); setProtocolConfig(cloneConfig()); setBlankChosen(true) }
  const resetTemplate = () => { if (selectedTemplate && window.confirm('确定恢复推荐模板内容？')) void loadTemplate(selectedTemplate.id) }
  const restoreTemplateFixtures = () => { if (!selectedTemplate) return; if (JSON.stringify(fixtures) !== JSON.stringify(selectedTemplate.examples) && !window.confirm('当前 Fixture 将替换为模板示例，确定继续吗？')) return; setFixtures(cloneFixtures(selectedTemplate.examples)) }
  const upload = async (file?: File) => { if (!file) return; if (file.size > 256 * 1024) return toast.error('源码最大 256 KiB'); if (source.trim() && !window.confirm('上传内容将覆盖当前编辑器，草稿已保存在服务端。继续吗？')) return; setSource(await file.text()) }
  const updateFixture = (index: number, changes: Partial<Fixture>) => setFixtures(current => current.map((item, position) => position === index ? { ...item, ...changes } : item))
  const addFixture = () => setFixtures(current => [...current, { name: `Fixture ${current.length + 1}`, stdin: '', ...(kind === 'validator' ? { expectedExitCode: 0 } : kind === 'classifier' ? { expectedSubtasks: [] } : {}) }])
  const addParameter = () => {
    let index = Object.keys(protocolConfig.parameterSchema).length + 1, key = `param${index}`
    while (protocolConfig.parameterSchema[key]) key = `param${++index}`
    setProtocolConfig(current => ({ ...current, parameterSchema: { ...current.parameterSchema, [key]: { type: 'integer', default: 1 } } }))
  }
  const renameParameter = (oldKey: string, nextKey: string) => {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(nextKey) || oldKey === nextKey || protocolConfig.parameterSchema[nextKey]) return
    setProtocolConfig(current => {
      const parameterSchema: Record<string, ParameterRule> = {}, profiles = current.profiles.map(profile => ({ ...profile, params: { ...profile.params } }))
      for (const [key, rule] of Object.entries(current.parameterSchema)) parameterSchema[key === oldKey ? nextKey : key] = rule
      for (const profile of profiles) if (Object.prototype.hasOwnProperty.call(profile.params, oldKey)) { profile.params[nextKey] = profile.params[oldKey]; delete profile.params[oldKey] }
      return { profiles, parameterSchema }
    })
  }
  const parseParameterValue = (value: string, type: ParameterRule['type']): string | number | boolean => type === 'boolean' ? value === 'true' : type === 'integer' ? Number.parseInt(value || '0', 10) : type === 'number' ? Number(value || 0) : value
  const retryVerification = async () => {
    if (!program || !versionId || !verification) return
    if (verification.mode === 'compile') { setVerification(null); const result = await apiClient.post<Verification>(`/api/problems/${problemId}/judge-programs/${program.id}/versions/${versionId}/compile`, {}); if (result.success && result.data) setVerification(result.data); else toast.error(result.message || '重新编译失败') }
    else { setVerification(null); await preflight() }
  }

  const knownSubtaskIds = useMemo(() => new Set(subtasks.map(item => item.id)), [subtasks])
  const unknownFixtureSubtasks = useMemo(() => kind === 'classifier' ? [...new Set(fixtures.flatMap(item => item.expectedSubtasks || []))].filter(id => !knownSubtaskIds.has(id)) : [], [fixtures, kind, knownSubtaskIds])

  const createVersion = async () => {
    setBusy(true)
    try {
      let created: CreatedProgramVersion
      if (method === 'dsl') {
        let spec: unknown
        try { spec = JSON.parse(source) } catch { return toast.error('Validator DSL 必须是合法 JSON') }
        const saved = await apiClient.post<IdPayload>(`/api/problems/${problemId}/validator-specs`, { spec })
        if (!saved.success || !saved.data) return toast.error(saved.message || 'DSL 保存失败')
        const materialized = await apiClient.post<CreatedProgramVersion>(`/api/problems/${problemId}/validator-specs/${saved.data.id}/materialize`, {})
        if (!materialized.success || !materialized.data) return toast.error(materialized.message || 'DSL 生成程序版本失败')
        created = materialized.data
      } else {
        const response = await apiClient.post<CreatedProgramVersion>(`/api/problems/${problemId}/judge-programs`, { kind, name: name || catalog?.capabilities[kind].title, language, protocol, templateId, templateVersion: selectedTemplateVersion, source, fixtures, protocolConfig })
        if (!response.success || !response.data) return toast.error(response.message || '程序版本创建失败')
        created = response.data
      }
      setProgram(created.program); setVersionId(created.version.id)
      const compile = await apiClient.post<Verification>(`/api/problems/${problemId}/judge-programs/${created.program.id}/versions/${created.version.id}/compile`, {})
      if (!compile.success || !compile.data) return toast.error(compile.message || '编译任务创建失败')
      setVerification(compile.data); toast.success('版本已保存，Judge 正在编译')
    } finally { setBusy(false) }
  }
  const preflight = async () => {
    if (!program || !versionId) return
    setBusy(true)
    try {
      const fixtureSet = await apiClient.post<IdPayload>(`/api/problems/${problemId}/judge-programs/${program.id}/fixture-sets`, { fixtures })
      if (!fixtureSet.success || !fixtureSet.data) return toast.error(fixtureSet.message || 'Fixture 保存失败')
      const result = await apiClient.post<Verification>(`/api/problems/${problemId}/judge-programs/${program.id}/versions/${versionId}/preflight`, { fixtureSetId: fixtureSet.data.id })
      if (!result.success || !result.data) return toast.error(result.message || '预检任务创建失败')
      setVerification(result.data)
    } finally { setBusy(false) }
  }
  const activate = async () => {
    if (!program || !versionId) return
    setBusy(true)
    try { const result = await apiClient.patch(`/api/problems/${problemId}/judge-programs/${program.id}`, { currentVersionId: versionId }); if (!result.success) return toast.error(result.message || '激活失败'); toast.success('评测程序已激活'); await onChanged(); onClose() } finally { setBusy(false) }
  }

  const canNext = step < 4
  const nextDisabled = step === 1 && !selectedTemplate && !blankChosen
  const footer = <div className={styles.footer}>
    <Button variant="secondary" onClick={step ? () => setStep(value => value - 1) : onClose}><ChevronLeft size={16} />{step ? '上一步' : '取消'}</Button>
    {canNext
      ? <Button variant="primary" disabled={nextDisabled} onClick={() => setStep(value => value + 1)}>下一步<ChevronRight size={16} /></Button>
      : !versionId
        ? <Button variant="primary" loading={busy} disabled={!source.trim() || !fixtures.length} onClick={createVersion}>保存版本并编译</Button>
        : verification?.status === 'completed' && verification.mode === 'compile'
          ? <Button variant="primary" loading={busy} disabled={unknownFixtureSubtasks.length > 0} onClick={preflight}>运行协议预检</Button>
          : verification?.status === 'completed' && verification.mode === 'preflight'
            ? <Button variant="primary" loading={busy} onClick={activate}>人工确认并激活</Button>
            : verification?.status === 'failed'
              ? <Button variant="primary" loading={busy} onClick={retryVerification}>修正后重新验证</Button>
              : <Button disabled>Judge 处理中…</Button>}
  </div>

  return <FormDialog isOpen={open} onClose={onClose} title="新增评测程序" description="选择完整示例 → 修改源码与 Fixture → Judge 编译和协议预检 → 人工激活" size="xl" dirty={Boolean(source) && !versionId} loading={busy} footer={footer}>
    <ol className={styles.steps}>{STEPS.map((label, index) => <li key={label} data-active={step === index} data-done={step > index}><span>{index + 1}</span>{label}</li>)}</ol>

    {step === 0 && <div className={styles.kindGrid}>{Object.entries(catalog?.capabilities || {}).filter(([value]) => judgeMode === 'oi' || value !== 'classifier').map(([value, capability]) => <Button variant={kind === value ? 'primary' : 'outline'} className={styles.kindCard} key={value} onClick={() => selectKind(value as Kind)}><strong>{capability.title}</strong><span>{capability.description}</span></Button>)}</div>}

    {step === 1 && <div className={styles.section}>
      <div className={styles.fixtureHeader}><div><h3>选择模板或空白开始</h3><p>模板会同时载入源码、Fixture；Generator 还会载入 Parameter Schema 和 Profile。不会自动创建或激活版本。</p></div></div>
      <div className={styles.templateGrid}>
        {templates.map(template => <article className={styles.templateCard} data-selected={templateId === template.id} key={template.id}>
          <div><strong>{template.title}</strong>{template.recommended && <span className={styles.recommended}>推荐</span>}</div>
          <p>{template.description}</p>
          <span>{languageLabel(template.language)} · {template.protocol} · {template.fixtureCount} 个 Fixture{template.profileCount ? ` · ${template.profileCount} 个 Profile` : ''}</span>
          <div className={styles.actions}><Button variant="secondary" onClick={() => void previewTemplateById(template.id)}>预览完整示例</Button><Button variant="primary" onClick={() => chooseTemplate(template.id)}>使用此模板</Button></div>
        </article>)}
      </div>
      {previewTemplate && <section className={styles.templatePreview}>
        <div className={styles.fixtureHeader}><div><h3>{previewTemplate.title} · 完整示例</h3><p>{previewTemplate.description}</p></div><Button variant="primary" onClick={() => chooseTemplate(previewTemplate.id)}>使用此模板</Button></div>
        <strong>协议</strong><div className={styles.protocol}>{previewTemplate.protocolHelp.map(item => <span key={item}>{item}</span>)}</div>
        <strong>{previewTemplate.language === 'validator-dsl' ? 'Validator DSL' : '源码'}</strong><pre>{previewTemplate.source}</pre>
        {previewTemplate.protocolConfig && <><strong>Parameter Schema 与 Profile</strong><pre>{JSON.stringify(previewTemplate.protocolConfig, null, 2)}</pre></>}
        <strong>Fixture（{previewTemplate.examples.length}）</strong>{previewTemplate.examples.map(item => <code key={item.name}>{item.name} · {item.expectedSubtasks?.length ? `Subtask ${item.expectedSubtasks.join(', ')}` : item.expectedStdout !== undefined ? '校验 stdout' : item.expectedExitCode === 0 ? '应接受' : item.expectedExitCode ? '应拒绝' : '确定性联调'}</code>)}
        <strong>使用前必须修改</strong><ul>{previewTemplate.requiredChanges.map(item => <li key={item}>{item}</li>)}</ul>
      </section>}
      <section className={styles.blankStart}>
        <div><strong>不使用模板，空白开始</strong><span>适合已经准备好完整源码和 Fixture 的管理员。</span></div>
        <Select aria-label="空白程序语言" value={language} onChange={event => switchLanguage(event.target.value)}>{Object.keys(catalog?.capabilities[kind]?.languages || {}).map(value => <option value={value} key={value}>{languageLabel(value)}</option>)}</Select>
        <Button variant={blankChosen && !templateId ? 'primary' : 'outline'} onClick={startBlank}>选择空白编辑器</Button>
      </section>
      <div className={styles.protocol}><strong>{catalog?.capabilities[kind]?.description}</strong>{catalog?.capabilities[kind]?.quickProtocol.map(item => <span key={item}>{item}</span>)}</div>
    </div>}

    {step === 2 && <div className={styles.section}>
      {selectedTemplate && <aside className={styles.templateBanner}><strong>正在使用：{selectedTemplate.title} v{selectedTemplateVersion ?? selectedTemplate.version}</strong><span>这是教学示例，必须按当前题目修改。</span></aside>}
      <div className={styles.editorHeader}><div><strong>{method === 'dsl' ? 'Validator DSL 示例（可修改）' : selectedTemplate ? '模板源码示例（可修改）' : '程序源码'}</strong><span>协议：{protocol} · 模板：{selectedTemplate ? selectedTemplate.title : '空白开始'}</span></div><div className={styles.actions}>{selectedTemplate && <Button variant="ghost" onClick={resetTemplate}><RotateCcw size={15} />恢复完整模板</Button>}<Button variant="ghost" onClick={() => setProtocolOpen(value => !value)}>查看协议</Button><label className={styles.upload}><Upload size={15} />上传源码<Input type="file" accept={method === 'dsl' ? '.json' : language === 'python3' ? '.py,.txt' : '.cpp,.cc,.cxx,.txt'} onChange={event => void upload(event.target.files?.[0])} /></label><Button variant="ghost" onClick={() => downloadSource(name, language, source)}><Download size={15} />下载</Button></div></div>
      {protocolOpen && <div className={styles.protocol}>{catalog?.capabilities[kind]?.quickProtocol.map(item => <span key={item}>{item}</span>)}</div>}
      <label>程序名称<Input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder={catalog?.capabilities[kind]?.title} /></label>
      <label>{method === 'dsl' ? 'Validator DSL 示例（可修改）' : '模板源码示例（可修改）'}<Textarea aria-label={method === 'dsl' ? 'Validator DSL 示例（可修改）' : '模板源码示例（可修改）'} className={styles.editor} spellCheck={false} value={source} onChange={event => setSource(event.target.value)} placeholder="选择模板、上传源码或从空白开始" /></label>
      {kind === 'classifier' && <aside className={styles.subtasks}><strong>{subtasks.length ? `当前题目 Subtask：${subtasks.map(item => `${item.id}（${item.score ?? '—'} 分）`).join('、')}` : '当前题目 Subtask：尚未建立'}</strong>{subtasks.length ? subtasks.map(item => <span key={item.id}>Subtask {item.id}（{item.score ?? '—'} 分）{item.dependencies?.length ? ` · 依赖 ${item.dependencies.join(', ')}` : ''}</span>) : <span>当前题目尚未建立 Subtask。</span>}{unknownFixtureSubtasks.length > 0 && <p className={styles.blocker}>模板 Fixture 引用了当前题目不存在的 Subtask：{unknownFixtureSubtasks.join(', ')}。请在下一步修改，否则不能预检。</p>}</aside>}
      {kind === 'generator' && <div className={styles.profiles}><strong>模板 Profile（已随源码载入）</strong>{protocolConfig.profiles.map((item, index) => <div key={index}><Input value={item.id} onChange={event => setProtocolConfig(current => ({ ...current, profiles: current.profiles.map((profile, position) => position === index ? { ...profile, id: event.target.value } : profile) }))} placeholder="profile id" /><Input value={item.label} onChange={event => setProtocolConfig(current => ({ ...current, profiles: current.profiles.map((profile, position) => position === index ? { ...profile, label: event.target.value } : profile) }))} placeholder="显示名称" /></div>)}</div>}
    </div>}

    {step === 3 && <div className={styles.section}>
      {kind === 'generator' && <section className={styles.parameterEditor}><div className={styles.fixtureHeader}><div><h3>Parameter Schema</h3><p>参数由服务端校验，Seed 由服务端安全生成；使用模板时 Schema 与 Profile 已完整载入。</p></div><Button variant="outline" onClick={addParameter}>添加参数</Button></div>{Object.entries(protocolConfig.parameterSchema).map(([key, rule]) => <article className={styles.parameter} key={key}><Input aria-label="参数名" defaultValue={key} onBlur={event => renameParameter(key, event.target.value.trim())} /><Select aria-label={`${key} 类型`} value={rule.type} onChange={event => setProtocolConfig(current => ({ ...current, parameterSchema: { ...current.parameterSchema, [key]: { ...rule, type: event.target.value as ParameterRule['type'] } } }))}><option value="integer">整数</option><option value="number">有限浮点数</option><option value="string">字符串</option><option value="boolean">布尔值</option></Select><Input aria-label={`${key} 默认值`} value={String(rule.default ?? '')} onChange={event => setProtocolConfig(current => ({ ...current, parameterSchema: { ...current.parameterSchema, [key]: { ...rule, default: parseParameterValue(event.target.value, rule.type) } } }))} placeholder="默认值" /><Button variant="ghost" onClick={() => setProtocolConfig(current => { const parameterSchema = { ...current.parameterSchema }; delete parameterSchema[key]; return { parameterSchema, profiles: current.profiles.map(profile => { const params = { ...profile.params }; delete params[key]; return { ...profile, params } }) } })}>删除</Button></article>)}</section>}
      <div className={styles.fixtureHeader}><div><h3>结构化 Fixture</h3><p>{kind === 'validator' ? '必须同时包含应通过与应拒绝输入。' : kind === 'classifier' ? '每条输入都要填写满足的全部 Subtask。' : kind === 'generator' ? 'Fixture 是完整 Generator Context，用于确定性、Validator、STD 和 Checker 联调。' : '每条输入都应提供明确期望输出。'}</p></div><div className={styles.actions}>{selectedTemplate && <Button variant="secondary" onClick={restoreTemplateFixtures}><RotateCcw size={15} />恢复模板 Fixture</Button>}<Button variant="outline" onClick={addFixture}>添加 Fixture</Button></div></div>
      {unknownFixtureSubtasks.length > 0 && <p className={styles.blocker}>以下 Subtask 不属于当前题目：{unknownFixtureSubtasks.join(', ')}。修改所有相关 Fixture 后才能运行协议预检。</p>}
      {fixtures.map((fixture, index) => <article className={styles.fixture} key={index}><div><div className={styles.fixtureName}><Input value={fixture.name} onChange={event => updateFixture(index, { name: event.target.value })} placeholder="Fixture 名称" /><span>{selectedTemplate?.examples.some(item => JSON.stringify(item) === JSON.stringify(fixture)) ? '模板示例' : '自定义'}</span></div><Button variant="ghost" onClick={() => setFixtures(current => current.filter((_, position) => position !== index))}>删除</Button></div><Textarea rows={5} value={fixture.stdin} onChange={event => updateFixture(index, { stdin: event.target.value })} placeholder={kind === 'generator' ? 'oj.generator/v1 Context JSON' : '完整 stdin'} />{kind === 'validator' && <Select value={fixture.expectedExitCode === 0 ? 'accept' : 'reject'} onChange={event => updateFixture(index, { expectedExitCode: event.target.value === 'accept' ? 0 : 1 })}><option value="accept">应接受（exit 0）</option><option value="reject">应拒绝（非 0）</option></Select>}{kind === 'classifier' && <Input value={(fixture.expectedSubtasks || []).join(',')} onChange={event => updateFixture(index, { expectedSubtasks: event.target.value.split(',').map(Number).filter(Number.isInteger) })} placeholder="预期全部 Subtask，例如 1,2,3" />}{kind === 'standard' && <Textarea rows={3} value={fixture.expectedStdout || ''} onChange={event => updateFixture(index, { expectedStdout: event.target.value })} placeholder="期望 stdout" />}</article>)}
    </div>}

    {step === 4 && <div className={styles.section}><h3>验证与激活</h3><p>保存源码不会直接上线。Judge 会编译一次、复用产物执行全部 Fixture，再由你明确激活。</p>{unknownFixtureSubtasks.length > 0 && <p className={styles.blocker}>Classifier Fixture 仍包含未知 Subtask：{unknownFixtureSubtasks.join(', ')}，协议预检已禁用。</p>}{!verification ? <div className={styles.pending}><AlertTriangle size={20} />尚未创建不可变版本</div> : <div className={verification.status === 'completed' ? styles.success : verification.status === 'failed' ? styles.failure : styles.pending}>{verification.status === 'completed' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}<div><strong>{verification.mode === 'compile' ? '编译' : '协议预检'}：{verification.status}</strong>{verification.errorMessage && <p>{verification.errorMessage}</p>}</div></div>}{verification?.report?.warnings?.map(item => <p className={styles.warning} key={item}>{item}</p>)}{verification?.report?.fixtures?.map(item => <article className={styles.report} key={item.name}><strong>{item.passed ? '✓' : '×'} {item.name}</strong><span>{item.message} · {item.timeMs} ms · {item.memoryKb} KiB</span>{item.stderrPreview && <pre>{item.stderrPreview}</pre>}</article>)}</div>}
  </FormDialog>
}
