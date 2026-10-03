'use client'

import { useState } from 'react'
import { Copy, Download, Eye, Sparkles } from 'lucide-react'
import { copyText } from '@/lib/clipboard'
import { Button } from '@/components/ui/Button'
import { DetailDialog } from '@/components/ui/Dialogs'
import { useToast } from '@/components/ui/Toast'
import type { JudgeProgramKind, ProgramCatalog, ProgramTemplate, ProgramTemplateSummary } from '../model/judgeProgramTemplateTypes'
import styles from './JudgeProgramTemplateGallery.module.css'
import { getJudgeProgramTemplate } from '../api/judgeProgramTemplateApi'
import { judgeProgramCopy, judgeProgramLanguageLabel, judgeProgramProtocolLabel } from '../model/judge-program-display'

const KINDS: Array<{ value: JudgeProgramKind; label: string; short: string }> = [
  { value: 'standard', label: '标准答案程序示例', short: '标准答案' },
  { value: 'validator', label: '输入检查程序示例', short: '输入检查' },
  { value: 'classifier', label: '子任务判定程序示例', short: '子任务判定' },
  { value: 'generator', label: '数据生成程序示例', short: '数据生成' },
]

function fixtureExpectation(template: ProgramTemplate, index: number) {
  const fixture = template.examples[index]
  if (fixture.expectedSubtasks?.length) return `子任务：${fixture.expectedSubtasks.join(', ')}`
  if (fixture.expectedStdout !== undefined) return `期望输出：\n${fixture.expectedStdout}`
  if (fixture.expectedExitCode !== undefined) return fixture.expectedExitCode === 0 ? '应接受' : '应拒绝'
  return '验证确定性及联调结果'
}

function downloadBundle(template: ProgramTemplate) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json;charset=utf-8' }))
  link.download = `${template.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-') || '评测程序模板'}.json`
  link.click()
  URL.revokeObjectURL(link.href)
}

export function JudgeProgramTemplateGallery({ catalog, subtasks, onUse }: {
  catalog: ProgramCatalog | null
  subtasks: Array<{ id: number; score?: number; dependencies?: number[] }>
  onUse: (templateId: string) => void
}) {
  const toast = useToast()
  const [kind, setKind] = useState<JudgeProgramKind>('standard')
  const [preview, setPreview] = useState<ProgramTemplate | null>(null)
  const [loadingId, setLoadingId] = useState('')
  const templates = catalog?.templates.filter(item => item.kind === kind) || []

  const openPreview = async (template: ProgramTemplateSummary) => {
    setLoadingId(template.id)
    try {
      setPreview(await getJudgeProgramTemplate(template.id))
    } catch {
      toast.error('模板示例加载失败')
    } finally {
      setLoadingId('')
    }
  }

  const knownSubtasks = new Set(subtasks.map(item => item.id))
  const referencedSubtasks = preview?.kind === 'classifier'
    ? [...new Set(preview.examples.flatMap(item => item.expectedSubtasks || []))]
    : []
  const unknownSubtasks = referencedSubtasks.filter(id => !knownSubtasks.has(id))

  return <section className={styles.gallery} aria-labelledby="judge-template-gallery-title">
    <div className={styles.heading}>
      <div>
        <h3 id="judge-template-gallery-title">内置模板与完整示例</h3>
        <p>先查看源码、运行规则、验证样例和参数配置，再决定是否载入草稿。模板不会自动启用。</p>
      </div>
      <Sparkles size={22} aria-hidden="true" />
    </div>

    <div className={styles.kindTabs} role="tablist" aria-label="评测程序模板类型">
      {KINDS.map(item => <Button
        key={item.value}
        variant={kind === item.value ? 'primary' : 'outline'}
        role="tab"
        aria-selected={kind === item.value}
        onClick={() => setKind(item.value)}
      >{item.label}</Button>)}
    </div>

    <div className={styles.templateGrid} role="tabpanel" aria-label={KINDS.find(item => item.value === kind)?.label}>
      {templates.map(template => <article className={styles.templateCard} key={template.id}>
        <div className={styles.cardTitle}>
          <div>
            <strong>{judgeProgramCopy(template.title, '评测程序模板')}</strong>
            <span>{judgeProgramLanguageLabel(template.language)} · {judgeProgramProtocolLabel(template.protocol)}</span>
          </div>
          {template.recommended && <span className={styles.recommended}>推荐</span>}
        </div>
        <p>{judgeProgramCopy(template.description)}</p>
        <div className={styles.inclusions}>
          <span>完整源码</span>
          <span>{template.fixtureCount} 个验证样例</span>
          {template.profileCount > 0 && <span>{template.profileCount} 个参数方案</span>}
          {template.hasProtocolConfig && <span>参数规则</span>}
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" loading={loadingId === template.id} onClick={() => void openPreview(template)}><Eye size={15} />查看完整示例</Button>
          <Button variant="primary" onClick={() => onUse(template.id)}>使用模板</Button>
        </div>
      </article>)}
    </div>

    <DetailDialog
      isOpen={Boolean(preview)}
      onClose={() => setPreview(null)}
      title={preview ? `${preview.title} · 完整示例` : '完整示例'}
      description={preview ? `${judgeProgramLanguageLabel(preview.language)} · ${judgeProgramProtocolLabel(preview.protocol)}` : undefined}
      size="xl"
      footer={preview ? <>
        <Button variant="secondary" onClick={() => setPreview(null)}>关闭</Button>
        <Button variant="secondary" onClick={() => void copyText(preview.source).then(() => toast.success('模板源码已复制'))}><Copy size={15} />复制源码</Button>
        <Button variant="secondary" onClick={() => downloadBundle(preview)}><Download size={15} />下载完整示例</Button>
        <Button variant="primary" onClick={() => { const id = preview.id; setPreview(null); onUse(id) }}>使用此模板</Button>
      </> : undefined}
    >
      {preview && <div className={styles.detail}>
        <section className={styles.notice}>
          <strong>这是教学示例，不是当前题目的自动答案</strong>
          <span>载入后必须按本题输入格式、约束、算法和子任务修改，并通过评测规则检查。</span>
        </section>

        {preview.kind === 'classifier' && <section className={styles.currentSubtasks}>
          <strong>{subtasks.length ? `当前题目子任务：${subtasks.map(item => `${item.id}（${item.score ?? '—'} 分）`).join('、')}` : '当前题目子任务：尚未建立'}</strong>
          {subtasks.length ? subtasks.map(item => <span key={item.id}>子任务 {item.id}（{item.score ?? '—'} 分）{item.dependencies?.length ? ` · 依赖 ${item.dependencies.join(', ')}` : ''}</span>) : <span>当前题目尚未建立子任务。</span>}
          {unknownSubtasks.length > 0 && <p>模板验证样例引用了当前题目不存在的子任务：{unknownSubtasks.join(', ')}。必须修改后才能预检。</p>}
        </section>}

        <section>
          <h4>用途与学习要点</h4>
          <p>{judgeProgramCopy(preview.description)}</p>
          <ul>{preview.learningNotes.map(item => <li key={item}>{judgeProgramCopy(item)}</li>)}</ul>
        </section>
        <section>
          <h4>输入与输出规则</h4>
          <ul>{preview.protocolHelp.map(item => <li key={item}>{judgeProgramCopy(item)}</li>)}</ul>
        </section>
        <section>
          <h4>{preview.language === 'validator-dsl' ? '输入规则示例' : '完整源码示例'}</h4>
          <pre>{preview.source}</pre>
        </section>
        {preview.protocolConfig && <section>
          <h4>数据生成参数</h4>
          <div className={styles.protocol}><span>可配置参数：{Object.keys(preview.protocolConfig.parameterSchema || {}).length} 项</span><span>预设参数方案：{preview.protocolConfig.profiles?.length || 0} 个</span></div>
        </section>}
        <section>
          <h4>验证样例（{preview.examples.length}）</h4>
          <div className={styles.fixtureGrid}>{preview.examples.map((fixture, index) => <article key={`${fixture.name}-${index}`}>
            <strong>{judgeProgramCopy(fixture.name, `验证样例 ${index + 1}`)}</strong>
            <span>{fixtureExpectation(preview, index)}</span>
            <pre>{fixture.stdin}</pre>
          </article>)}</div>
        </section>
        <section className={styles.requiredChanges}>
          <h4>使用前必须修改</h4>
          <ul>{preview.requiredChanges.map(item => <li key={item}>{judgeProgramCopy(item)}</li>)}</ul>
        </section>
      </div>}
    </DetailDialog>
  </section>
}
