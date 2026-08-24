'use client'

import { useEffect, useState } from 'react'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import styles from './ProblemHackConfigPanel.module.css'

interface HackConfig {
  enabled: boolean
  standardSource: string
  validatorSource: string
  revision: number
}

export function ProblemHackConfigPanel({ problemId, judgeMode, problemType }: {
  problemId: string
  judgeMode: 'acm' | 'oi'
  problemType: string
}) {
  const toast = useToast()
  const [config, setConfig] = useState<HackConfig>({ enabled: false, standardSource: '', validatorSource: '', revision: 0 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    apiClient.get<HackConfig>(`/api/problems/${problemId}/hack-config`).then(result => {
      if (mounted && result.success && result.data) setConfig(result.data)
    }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [problemId])

  const readSource = async (file: File | undefined, key: 'standardSource' | 'validatorSource') => {
    if (!file) return
    if (file.size > 256 * 1024) return toast.error('源码文件不能超过 256 KiB')
    const source = await file.text()
    setConfig(current => ({ ...current, [key]: source }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const result = await apiClient.put<HackConfig>(`/api/problems/${problemId}/hack-config`, {
        enabled: config.enabled,
        standardSource: config.standardSource,
        validatorSource: config.validatorSource,
      }, { timeout: 150_000 })
      if (!result.success || !result.data) return toast.error(result.message || '保存失败')
      setConfig(result.data)
      toast.success(result.message || 'Hack 配置已保存')
    } finally {
      setSaving(false)
    }
  }

  const hackable = judgeMode === 'acm' && ['default', 'standard'].includes(problemType)
  if (loading) return <div className={styles.intro}>正在加载 Hack 配置…</div>

  return (
    <div className={styles.panel}>
      <div className={styles.intro}>
        题目级 Hack 会使用 Validator 校验候选输入，由标准程序生成答案，再对用户提供的程序进行两次完整 ACM 评测。有效 Hack 会成为正式测试点，但不会重测历史提交。
      </div>
      <div className={styles.switchRow}>
        <div>
          <div className={styles.switchTitle}>允许拥有题目提交权限的用户发起 Hack</div>
          <div className={styles.switchHint}>{hackable ? '启用前会在 go-judge 沙箱中编译检查 STD 与 Validator。' : '仅 ACM 的标准批处理题支持 Hack。'}</div>
        </div>
        <label>
          <input type="checkbox" checked={config.enabled} disabled={!hackable} onChange={event => setConfig(current => ({ ...current, enabled: event.target.checked }))} /> 启用 Hack
        </label>
      </div>
      <div className={styles.sourceGrid}>
        <SourceEditor title="标准程序（STD）" hint="C++17 · 遵循题目现有文件读写配置" value={config.standardSource} onChange={value => setConfig(current => ({ ...current, standardSource: value }))} onFile={file => readSource(file, 'standardSource')} />
        <SourceEditor title="输入校验程序（Validator）" hint={'C++17 · 可直接 #include "testlib.h"'} value={config.validatorSource} onChange={value => setConfig(current => ({ ...current, validatorSource: value }))} onFile={file => readSource(file, 'validatorSource')} />
      </div>
      <div className={styles.footer}>
        <span className={styles.revision}>当前配置 revision {config.revision || '尚未保存'}</span>
        <button type="button" className={styles.save} disabled={saving || (config.enabled && (!config.standardSource.trim() || !config.validatorSource.trim()))} onClick={save}>
          {saving ? '正在编译检查并保存…' : '保存 Hack 配置'}
        </button>
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
        <label className={styles.upload}>上传源码<input type="file" accept=".cpp,.cc,.cxx,text/plain" onChange={event => onFile(event.target.files?.[0])} /></label>
      </div>
      <textarea className={styles.editor} spellCheck={false} value={value} onChange={event => onChange(event.target.value)} placeholder={`在这里填写${title}源码…`} />
    </section>
  )
}
