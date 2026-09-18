'use client'

import { useEffect, useState } from 'react'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import styles from './ProblemHackConfigPanel.module.css'
import { getProblemHackConfig, saveProblemHackConfig } from '../api/problemHackConfigApi'
import type { ProblemHackConfig } from '@oi-manager/contracts'

type HackConfig = ProblemHackConfig

export function ProblemHackConfigPanel({ problemId, judgeMode, problemType }: {
  problemId: string
  judgeMode: 'acm' | 'oi'
  problemType: string
}) {
  const toast = useToast()
  const [config, setConfig] = useState<HackConfig>({ enabled: false, mode: judgeMode, standardSource: '', validatorSource: '', classifierSource: '', revision: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    getProblemHackConfig(problemId).then(result => {
      if (mounted) setConfig(result)
    }).catch(() => {
      if (mounted) toast.error('Hack 配置加载失败')
    }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [problemId])

  const readSource = async (file: File | undefined, key: 'standardSource' | 'validatorSource' | 'classifierSource') => {
    if (!file) return
    if (file.size > 256 * 1024) return toast.error('源码文件不能超过 256 KiB')
    const source = await file.text()
    setConfig(current => ({ ...current, [key]: source }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const result = await saveProblemHackConfig(problemId, {
        enabled: config.enabled,
        standardSource: config.standardSource,
        validatorSource: config.validatorSource,
        classifierSource: config.classifierSource,
        expectedRevision: config.revision,
      })
      if (!result.ok) return toast.error(result.error.message || '保存失败')
      setConfig(result.data)
      toast.success(config.enabled ? 'Hack 已启用' : 'Hack 配置已保存')
    } finally {
      setSaving(false)
    }
  }

  const hackable = ['acm', 'oi'].includes(judgeMode) && ['default', 'standard'].includes(problemType)
  if (loading) return <div className={styles.intro}>正在加载 Hack 配置…</div>

  return (
    <div className={styles.panel}>
      <div className={styles.intro}>
        {judgeMode === 'oi'
          ? 'OI / IOI Hack 会由 Classifier 自动判断候选数据命中的全部 Subtask。证明程序加入候选点后总分下降才有效；有效数据进入各 Subtask 的 Hack Gate，但不会重测历史提交。'
          : '题目级 Hack 会使用 Validator 校验候选输入，由标准程序生成答案，再对用户提供的程序进行两次完整 ACM 评测。有效 Hack 会成为正式测试点，但不会重测历史提交。'}
      </div>
      <div className={styles.switchRow}>
        <div>
          <div className={styles.switchTitle}>允许拥有题目提交权限的用户发起 Hack</div>
          <div className={styles.switchHint}>{hackable ? `启用前会在 go-judge 沙箱中编译检查 STD、Validator${judgeMode === 'oi' ? ' 与 Classifier' : ''}。` : '仅 ACM / OI 的标准批处理题支持 Hack。'}</div>
        </div>
        <label>
          <Input type="checkbox" checked={config.enabled} disabled={!hackable} onChange={event => setConfig(current => ({ ...current, enabled: event.target.checked }))} /> 启用 Hack
        </label>
      </div>
      <div className={styles.sourceGrid}>
        <SourceEditor title="标准程序（STD）" hint="C++17 · 遵循题目现有文件读写配置" value={config.standardSource} onChange={value => setConfig(current => ({ ...current, standardSource: value }))} onFile={file => readSource(file, 'standardSource')} />
        <SourceEditor title="输入校验程序（Validator）" hint={'C++17 · 可直接 #include "testlib.h"'} value={config.validatorSource} onChange={value => setConfig(current => ({ ...current, validatorSource: value }))} onFile={file => readSource(file, 'validatorSource')} />
        {judgeMode === 'oi' && <SourceEditor title="子任务分类程序（Classifier）" hint={'C++17 · stdout 输出 {"subtasks":[1,2]}'} value={config.classifierSource} onChange={value => setConfig(current => ({ ...current, classifierSource: value }))} onFile={file => readSource(file, 'classifierSource')} />}
      </div>
      <div className={styles.footer}>
        <span className={styles.revision}>当前配置 revision {config.revision || '尚未保存'}</span>
        <Button variant="ghost" type="button" className={styles.save} disabled={saving || (config.enabled && (!config.standardSource.trim() || !config.validatorSource.trim() || (judgeMode === 'oi' && !config.classifierSource.trim())))} onClick={save}>
          {saving ? '正在编译检查并保存…' : '保存 Hack 配置'}
        </Button>
      </div>
    </div>
  )
}

function SourceEditor({ title, hint, value, onChange, onFile }: {
  title: string
  hint: string
  value: string
  onChange: (value: string) => void
  onFile: (file?: File) => void
}) {
  return (
    <section className={styles.sourceCard}>
      <div className={styles.sourceHeader}>
        <div><div className={styles.sourceTitle}>{title}</div><div className={styles.sourceMeta}>{hint}</div></div>
        <label className={styles.upload}>上传源码<Input type="file" accept=".cpp,.cc,.cxx,text/plain" onChange={event => onFile(event.target.files?.[0])} /></label>
      </div>
      <Textarea className={styles.editor} spellCheck={false} value={value} onChange={event => onChange(event.target.value)} placeholder={`在这里填写${title}源码…`} />
    </section>
  )
}
