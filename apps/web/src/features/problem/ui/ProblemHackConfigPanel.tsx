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
      if (mounted) toast.error('反例设置加载失败')
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
      if (!result.ok) return toast.error(result.error.userMessage || '保存失败')
      setConfig(result.data)
      toast.success(config.enabled ? '已允许提交反例' : '反例设置已保存')
    } finally {
      setSaving(false)
    }
  }

  const hackable = ['acm', 'oi'].includes(judgeMode) && ['default', 'standard'].includes(problemType)
  if (loading) return <div className={styles.intro}>正在加载反例设置…</div>

  return (
    <div className={styles.panel}>
      <div className={styles.intro}>
        {judgeMode === 'oi'
          ? 'OI / IOI 题会自动判断反例影响的子任务。只有能使证明程序得分下降的输入才算有效；通过检查的数据会进入候选数据，不会改动历史评测结果。'
          : 'ACM 题会先检查反例输入，再生成标准答案并重复验证用户程序。通过检查的反例会成为正式测试点，不会改动历史评测结果。'}
      </div>
      <div className={styles.switchRow}>
        <div>
          <div className={styles.switchTitle}>允许拥有题目提交权限的用户提交反例</div>
          <div className={styles.switchHint}>{hackable ? `启用前会编译并检查标准答案程序、输入检查程序${judgeMode === 'oi' ? '和子任务判定程序' : ''}。` : '仅 ACM / OI 的标准批处理题支持提交反例。'}</div>
        </div>
        <label>
          <Input type="checkbox" checked={config.enabled} disabled={!hackable} onChange={event => setConfig(current => ({ ...current, enabled: event.target.checked }))} /> 允许提交反例
        </label>
      </div>
      <div className={styles.sourceGrid}>
        <SourceEditor title="标准答案程序" hint="C++17 · 遵循题目现有文件读写配置" value={config.standardSource} onChange={value => setConfig(current => ({ ...current, standardSource: value }))} onFile={file => readSource(file, 'standardSource')} />
        <SourceEditor title="输入检查程序" hint={'C++17 · 可直接 #include "testlib.h"'} value={config.validatorSource} onChange={value => setConfig(current => ({ ...current, validatorSource: value }))} onFile={file => readSource(file, 'validatorSource')} />
        {judgeMode === 'oi' && <SourceEditor title="子任务判定程序" hint={'C++17 · 输出命中的全部子任务编号'} value={config.classifierSource} onChange={value => setConfig(current => ({ ...current, classifierSource: value }))} onFile={file => readSource(file, 'classifierSource')} />}
      </div>
      <div className={styles.footer}>
        <span className={styles.revision}>当前配置</span>
        <Button variant="ghost" type="button" className={styles.save} disabled={saving || (config.enabled && (!config.standardSource.trim() || !config.validatorSource.trim() || (judgeMode === 'oi' && !config.classifierSource.trim())))} onClick={save}>
          {saving ? '正在编译检查并保存…' : '保存反例设置'}
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
