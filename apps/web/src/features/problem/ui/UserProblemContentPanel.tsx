'use client'

import { useCallback, useEffect, useState } from 'react'
import unifiedStyles from './UserProblemContentPanel.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import type {
  ProblemPersonalContent,
  ProblemPersonalContentKind as Kind,
} from '@oi-manager/contracts'
import {
  deleteProblemPersonalContent,
  getProblemPersonalContent,
  saveProblemPersonalContent,
  updateProblemPersonalContentShares,
  uploadProblemPersonalContentPdf,
} from '../api/problemUserContentApi'

type Format = 'markdown' | 'pdf'

interface Props {
  problemId: string
}

export function UserProblemContentPanel({ problemId }: Props) {
  const toast = useToast()
  const [kind] = useState<Kind>('solution')
  const [format, setFormat] = useState<Format>('markdown')
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState('zh')
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [shareKeys, setShareKeys] = useState<string[]>([])
  const [items, setItems] = useState<ProblemPersonalContent[]>([])
  const [shareTargets, setShareTargets] = useState<Array<{ key: string; label: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getProblemPersonalContent(problemId)
      setItems(data.contents)
      setShareTargets(data.shareTargets)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载个人版本失败')
    } finally {
      setLoading(false)
    }
  }, [problemId, toast])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const current = items.find(item => item.kind === kind)
    setFormat(current?.format || 'markdown')
    setTitle(current?.title || '')
    setLanguage(current?.language || 'zh')
    setContent(current?.content || '')
    setShareKeys(current?.shareKeys || [])
    setFile(null)
  }, [items, kind])

  const save = async () => {
    setSaving(true)
    try {
      if (format === 'markdown') {
        const response = await saveProblemPersonalContent(problemId, kind, { title, language, content })
        if (!response.ok) {
          toast.error(response.error.message || '保存失败')
          return
        }
      } else {
        if (!file) {
          toast.error(items.find(item => item.kind === kind)?.format === 'pdf' ? '请选择新 PDF，或保留当前版本不保存' : '请选择 PDF 文件')
          return
        }
        const body = new FormData()
        body.append('file', file)
        body.append('title', title)
        body.append('language', language)
        const response = await uploadProblemPersonalContentPdf(problemId, kind, body)
        if (!response.success) {
          toast.error(response.message || '保存失败')
          return
        }
      }
      const shareResponse = await updateProblemPersonalContentShares(problemId, kind, shareKeys)
      if (!shareResponse.ok) {
        toast.warning(shareResponse.error.message || '内容已保存，但共享范围保存失败')
      } else {
        toast.success('个人版本已保存')
      }
      await load()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`确定删除我的${kind === 'statement' ? '题面' : '题解'}吗？已被活动选用的快照不会受影响。`)) return
    const response = await deleteProblemPersonalContent(problemId, kind)
    if (response.ok) {
      toast.success('已删除')
      await load()
    } else toast.error(response.error.message || '删除失败')
  }

  const current = items.find(item => item.kind === kind)
  const toggleShare = (key: string) => setShareKeys(keys => keys.includes(key) ? keys.filter(item => item !== key) : [...keys, key])
  if (loading) return <div className={unifiedStyles.u1}>正在加载个人版本…</div>

  return (
    <div className={unifiedStyles.u2}>
      <div className={unifiedStyles.u3}>
        <strong>我的题解</strong>
        {current && <span className={unifiedStyles.u4}>上次保存：{new Date(current.updatedAt).toLocaleString('zh-CN')}</span>}
      </div>

      <div className={`${unifiedStyles.contentGrid} ${kind === 'statement' ? unifiedStyles.statementGrid : unifiedStyles.solutionGrid}`}>
        {kind === 'statement' && <label className={unifiedStyles.u5}>题面标题<Input value={title} onChange={event => setTitle(event.target.value)} placeholder="默认使用原题标题" className={unifiedStyles.u6} /></label>}
        <label className={unifiedStyles.u5}>格式<Select value={format} onChange={event => setFormat(event.target.value as Format)} className={unifiedStyles.u7}><option value="markdown">Markdown</option><option value="pdf">PDF</option></Select></label>
        <label className={unifiedStyles.u5}>语言<Select value={language} onChange={event => setLanguage(event.target.value)} className={unifiedStyles.u7}><option value="zh">中文</option><option value="en">English</option></Select></label>
      </div>

      {format === 'markdown' ? (
        <MarkdownEditor value={content} onChange={setContent} minHeight="360px" showPreview />
      ) : (
        <div className={unifiedStyles.u8}>
          {current?.format === 'pdf' && current.fileUrl && <a href={current.fileUrl} target="_blank" rel="noreferrer" className={unifiedStyles.u9}>查看当前 PDF</a>}
          <Input type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] || null)} />
          <div className={unifiedStyles.u10}>仅支持 PDF，最大 20MB。</div>
        </div>
      )}

      <div className={unifiedStyles.u11}>
        <div className={unifiedStyles.u12}>允许活动管理员选用</div>
        <label className={unifiedStyles.u13}><Input type="checkbox" checked={shareKeys.includes('platform')} onChange={() => toggleShare('platform')} /> 全平台</label>
        {shareTargets.map(target => <label key={target.key} className={unifiedStyles.u13}><Input type="checkbox" checked={shareKeys.includes(target.key)} onChange={() => toggleShare(target.key)} /> {target.label}</label>)}
        <div className={unifiedStyles.u14}>未勾选时仅自己创建或管理活动时可以选用。</div>
      </div>

      <div className={unifiedStyles.u15}>
        {current && <Button variant="ghost" onClick={remove} disabled={saving} className={unifiedStyles.u16}>删除</Button>}
        <Button variant="ghost" onClick={save} disabled={saving} className={unifiedStyles.u17}>{saving ? '保存中…' : '保存个人版本'}</Button>
      </div>
    </div>
  )
}
