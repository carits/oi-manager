'use client'

import { useState } from 'react'
import { Copy, Download, Eye, Sparkles } from 'lucide-react'
import apiClient from '@/lib/apiClient'
import { copyText } from '@/lib/clipboard'
import { Button } from '@/components/ui/Button'
import { DetailDialog } from '@/components/ui/Dialogs'
import { useToast } from '@/components/ui/Toast'
import type { JudgeProgramKind, ProgramCatalog, ProgramTemplate, ProgramTemplateSummary } from '../model/judgeProgramTemplateTypes'
import styles from './JudgeProgramTemplateGallery.module.css'

const KINDS: Array<{ value: JudgeProgramKind; label: string; short: string }> = [
  { value: 'standard', label: '标准程序 STD 示例', short: 'STD' },
  { value: 'validator', label: '输入校验器 Validator 示例', short: 'Validator' },
  { value: 'classifier', label: '子任务分类器 Classifier 示例', short: 'Classifier' },
  { value: 'generator', label: '数据生成器 Generator 示例', short: 'Generator' },
]

function languageLabel(language: string) {
  if (language === 'python3') return 'Python3'
  if (language === 'validator-dsl') return 'Validator DSL'
  return 'C++17'
}

function fixtureExpectation(template: ProgramTemplate, index: number) {
  const fixture = template.examples[index]
  if (fixture.expectedSubtasks?.length) return `Subtask：${fixture.expectedSubtasks.join(', ')}`
  if (fixture.expectedStdout !== undefined) return `期望 stdout：\n${fixture.expectedStdout}`
  if (fixture.expectedExitCode !== undefined) return fixture.expectedExitCode === 0 ? '应接受（exit 0）' : '应拒绝（非 0）'
  return '验证确定性及联调结果'
}

function downloadBundle(template: ProgramTemplate) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json;charset=utf-8' }))
  link.download = `${template.id}-v${template.version}.json`
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
      const result = await apiClient.get<ProgramTemplate>(`/api/judge-program-templates/${template.id}`)
      if (!result.success || !result.data) return toast.error(result.message || '模板示例加载失败')
      setPreview(result.data)
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
        <p>先查看源码、协议、Fixture 和参数配置，再明确选择是否载入草稿。模板不会自动激活。</p>
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
            <strong>{template.title}</strong>
            <span>{languageLabel(template.language)} · {template.protocol} · v{template.version}</span>
          </div>
          {template.recommended && <span className={styles.recommended}>推荐</span>}
        </div>
        <p>{template.description}</p>
        <div className={styles.inclusions}>
          <span>完整源码</span>
          <span>{template.fixtureCount} 个 Fixture</span>
          {template.profileCount > 0 && <span>{template.profileCount} 个 Profile</span>}
          {template.hasProtocolConfig && <span>参数 Schema</span>}
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
      description={preview ? `${languageLabel(preview.language)} · ${preview.protocol} · 模板 v${preview.version}` : undefined}
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
          <span>载入后必须按本题输入格式、约束、算法和 Subtask 修改，并通过 Judge 协议预检。</span>
        </section>

        {preview.kind === 'classifier' && <section className={styles.currentSubtasks}>
          <strong>{subtasks.length ? `当前题目 Subtask：${subtasks.map(item => `${item.id}（${item.score ?? '—'} 分）`).join('、')}` : '当前题目 Subtask：尚未建立'}</strong>
          {subtasks.length ? subtasks.map(item => <span key={item.id}>Subtask {item.id}（{item.score ?? '—'} 分）{item.dependencies?.length ? ` · 依赖 ${item.dependencies.join(', ')}` : ''}</span>) : <span>当前题目尚未建立 Subtask。</span>}
          {unknownSubtasks.length > 0 && <p>模板 Fixture 引用了当前题目不存在的 Subtask：{unknownSubtasks.join(', ')}。必须修改后才能预检。</p>}
        </section>}

        <section>
          <h4>用途与学习要点</h4>
          <p>{preview.description}</p>
          <ul>{preview.learningNotes.map(item => <li key={item}>{item}</li>)}</ul>
        </section>
        <section>
          <h4>stdin / stdout 协议</h4>
          <ul>{preview.protocolHelp.map(item => <li key={item}>{item}</li>)}</ul>
        </section>
        <section>
          <h4>{preview.language === 'validator-dsl' ? 'Validator DSL 示例' : '完整源码示例'}</h4>
          <pre>{preview.source}</pre>
        </section>
        {preview.protocolConfig && <section>
          <h4>Generator Parameter Schema 与 Profile</h4>
          <pre>{JSON.stringify(preview.protocolConfig, null, 2)}</pre>
        </section>}
        <section>
          <h4>Fixture 示例（{preview.examples.length}）</h4>
          <div className={styles.fixtureGrid}>{preview.examples.map((fixture, index) => <article key={`${fixture.name}-${index}`}>
            <strong>{fixture.name}</strong>
            <span>{fixtureExpectation(preview, index)}</span>
            <pre>{fixture.stdin}</pre>
          </article>)}</div>
        </section>
        <section className={styles.requiredChanges}>
          <h4>使用前必须修改</h4>
          <ul>{preview.requiredChanges.map(item => <li key={item}>{item}</li>)}</ul>
        </section>
      </div>}
    </DetailDialog>
  </section>
}
