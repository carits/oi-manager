'use client'

import { useCallback, useEffect, useState } from 'react'
import unifiedStyles from './UserProblemContentPanel.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'

type Kind = 'statement' | 'solution'
type Format = 'markdown' | 'pdf'

interface PersonalContent {
  id: string
  kind: Kind
  title: string | null
  format: Format
  language: string | null
  content: string | null
  fileUrl: string | null
  revision: number
  updatedAt: string
  shareKeys: string[]
}

interface Props {
  problemId: string
  apiBase?: string
}

export function UserProblemContentPanel({ problemId, apiBase }: Props) {
  const toast = useToast()
  const base = apiBase || `/api/problems/${problemId}`
  const [kind] = useState<Kind>('solution')
  const [format, setFormat] = useState<Format>('markdown')
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState('zh')
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [shareKeys, setShareKeys] = useState<string[]>([])
  const [items, setItems] = useState<PersonalContent[]>([])
  const [shareTargets, setShareTargets] = useState<Array<{ key: string; label: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const response = await apiClient.get<{ contents: PersonalContent[]; shareTargets: Array<{ key: string; label: string }> }>(`${base}/my-content`)
    if (response.success && response.data) {
      setItems(response.data.contents)
      setShareTargets(response.data.shareTargets)
    } else toast.error(response.message || '加载个人版本失败')
    setLoading(false)
  }, [base, toast])

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
      let response
      if (format === 'markdown') {
        response = await apiClient.put(`${base}/my-content/${kind}`, { title, language, content })
      } else {
        if (!file) {
          toast.error(items.find(item => item.kind === kind)?.format === 'pdf' ? '请选择新 PDF，或保留当前版本不保存' : '请选择 PDF 文件')
          return
        }
        const body = new FormData()
        body.append('file', file)
        body.append('title', title)
        body.append('language', language)
        response = await apiClient.post(`${base}/my-content/${kind}/pdf`, body, { timeout: 30000 })
      }
      if (!response.success) {
        toast.error(response.message || '保存失败')
        return
      }
      const shareResponse = await apiClient.put(`${base}/my-content/${kind}/shares`, { shareKeys })
      if (!shareResponse.success) {
        toast.warning(shareResponse.message || '内容已保存，但共享范围保存失败')
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
    const response = await apiClient.delete(`${base}/my-content/${kind}`)
    if (response.success) {
      toast.success('已删除')
      await load()
    } else toast.error(response.message || '删除失败')
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
