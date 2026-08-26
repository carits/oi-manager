'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import unifiedStyles from './StatementVersionWorkspace.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { useSearchParams } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { FormDialog } from '@/components/ui/Dialogs'
import { useToast } from '@/components/ui/Toast'

interface Version {
  id: string
  key?: string
  name: string
  title?: string | null
  language?: string | null
  format: 'markdown' | 'pdf'
  visibility: 'private' | 'public'
  authorUsername?: string | null
  isOfficial?: boolean
  isMine?: boolean
  content?: string | null
  fileUrl?: string | null
  sourceNameSnapshot?: string | null
  sourceAuthorSnapshot?: string | null
}

interface VersionList {
  official: Version[]
  mine: Version[]
  public: Version[]
  publicPagination: { page: number; pageSize: number; total: number }
}

export function StatementVersionWorkspace({ problemId }: { problemId: string }) {
  const toast = useToast()
  const searchParams = useSearchParams()
  const [data, setData] = useState<VersionList | null>(null)
  const [selected, setSelected] = useState<Version | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [language, setLanguage] = useState('zh')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [createMode, setCreateMode] = useState<'current' | 'blank'>('current')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (all = showAll) => {
    setLoading(true)
    const response = await apiClient.get<VersionList>(`/api/problems/${problemId}/statement-versions?pageSize=${all ? 50 : 10}`)
    if (!response.success || !response.data) toast.error(response.message || '加载题面版本失败')
    else {
      setData(response.data)
      const requested = searchParams.get('statementVersion')
      const allRows = [...response.data.official, ...response.data.mine, ...response.data.public]
      let next = requested ? allRows.find(item => item.id === requested) : null
      if (requested && !next) {
        const detail = await apiClient.get<Version>(`/api/problems/${problemId}/statement-versions/${requested}`)
        if (detail.success && detail.data) next = detail.data
        else toast.warning('指定题面不可访问，已回到默认官方题面')
      }
      next ||= selected ? allRows.find(item => item.id === selected.id) : null
      next ||= response.data.official[0] || response.data.mine[0] || response.data.public[0] || null
      setSelected(next)
    }
    setLoading(false)
  }, [problemId, searchParams, selected, showAll, toast])

  useEffect(() => { void load() }, [problemId, showAll]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (item: Version) => {
    let detail = item
    if (!item.isOfficial && item.content === undefined) {
      const response = await apiClient.get<Version>(`/api/problems/${problemId}/statement-versions/${item.id}`)
      if (!response.success || !response.data) return toast.error(response.message || '题面不可访问')
      detail = response.data
    }
    setSelected(detail)
    setEditing(false)
    const url = new URL(window.location.href)
    url.searchParams.set('statementVersion', item.id)
    window.history.replaceState({}, '', url)
  }

  const openCreate = (base?: Version | null) => {
    if (base) setSelected(base)
    setName('')
    setLanguage(base?.language || 'zh')
    setVisibility('private')
    setCreateMode(base ? 'current' : 'blank')
    setCreateOpen(true)
  }

  const create = async () => {
    setSaving(true)
    const source = createMode === 'blank' || !selected
      ? { type: 'blank' }
      : selected.isOfficial ? { type: 'canonical', id: selected.id } : { type: 'user', id: selected.id }
    const response = await apiClient.post<Version>(`/api/problems/${problemId}/statement-versions`, {
      name, language, visibility, format: selected?.format || 'markdown', source,
    })
    if (response.success && response.data) {
      setCreateOpen(false)
      setShowAll(true)
      await load(true)
      await choose(response.data)
      if (response.data.format === 'markdown') { setDraft(response.data.content || ''); setEditing(true) }
      toast.success('题面版本已创建')
    } else toast.error(response.message || '创建失败')
    setSaving(false)
  }

  const saveContent = async () => {
    if (!selected?.isMine) return
    setSaving(true)
    const response = await apiClient.put<Version>(`/api/problems/${problemId}/statement-versions/${selected.id}/content`, { content: draft, title: selected.title })
    if (response.success && response.data) { setSelected(response.data); setEditing(false); toast.success('题面已保存'); await load(showAll) }
    else toast.error(response.message || '保存失败')
    setSaving(false)
  }

  const patchSelected = async (body: Record<string, unknown>) => {
    if (!selected?.isMine) return
    const response = await apiClient.patch<Version>(`/api/problems/${problemId}/statement-versions/${selected.id}`, body)
    if (response.success && response.data) { setSelected(response.data); await load(showAll) }
    else toast.error(response.message || '修改失败')
  }

  const remove = async () => {
    if (!selected?.isMine || !window.confirm(`确定删除题面「${selected.name}」吗？活动快照不会受影响。`)) return
    const response = await apiClient.delete(`/api/problems/${problemId}/statement-versions/${selected.id}`)
    if (response.success) { toast.success('题面已删除'); setSelected(null); await load(showAll) }
    else toast.error(response.message || '删除失败')
  }

  const uploadPdf = async (file: File | undefined) => {
    if (!selected?.isMine || !file) return
    const body = new FormData()
    body.append('file', file)
    setSaving(true)
    const response = await apiClient.postFile<Version>(`/api/problems/${problemId}/statement-versions/${selected.id}/pdf`, body)
    if (response.success && response.data) {
      setSelected(response.data)
      setEditing(false)
      toast.success('PDF 题面已上传')
      await load(showAll)
    } else toast.error(response.message || 'PDF 上传失败')
    if (pdfInputRef.current) pdfInputRef.current.value = ''
    setSaving(false)
  }

  const groups = useMemo(() => data ? [
    { title: '官方', rows: data.official },
    { title: '我的题面', rows: data.mine },
    { title: '公开题面', rows: data.public },
  ] : [], [data])

  const itemButton = (item: Version) => (
    <Button variant="ghost" key={`${item.isOfficial ? 'official' : 'user'}-${item.id}`} onClick={() => choose(item)} className={unifiedStyles.versionButton} aria-selected={selected?.id === item.id}>
      <strong className={unifiedStyles.u1}>{item.name}</strong>
      <span className={unifiedStyles.u2}>
        {item.isOfficial ? 'System · 官方' : `${item.authorUsername || ''} · ${item.isMine ? (item.visibility === 'public' ? '我的 · 公开' : '我的 · 私有') : '公开'}`} · {item.language || '未知'}
      </span>
    </Button>
  )

  if (loading && !data) return <div className={unifiedStyles.u3}>正在加载题面版本…</div>

  return (
    <div className={unifiedStyles.u4}>
      <aside className={unifiedStyles.u5}>
        <div className={unifiedStyles.u6}>
          <strong>题面版本</strong><Button variant="ghost" onClick={() => openCreate(selected)} className={unifiedStyles.u7}>+ 创建</Button>
        </div>
        {groups.map(group => <section key={group.title} className={unifiedStyles.u8}>
          <div className={unifiedStyles.u9}>{group.title}</div>
          {group.rows.length ? group.rows.map(itemButton) : <div className={unifiedStyles.u10}>暂无</div>}
        </section>)}
        {data && data.publicPagination.total > data.public.length && <Button variant="ghost" onClick={() => setShowAll(true)} className={unifiedStyles.u11}>查看全部公开题面</Button>}
      </aside>
      <main className={unifiedStyles.u12}>
        {!selected ? <div className={unifiedStyles.u13}>暂无题面</div> : <>
          {selected.isMine && <div className={unifiedStyles.u14}>
            {selected.format === 'markdown' && <Button variant="ghost" onClick={() => { setDraft(selected.content || ''); setEditing(true) }}>编辑</Button>}
            <Input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={event => void uploadPdf(event.target.files?.[0])} />
            <Button variant="ghost" onClick={() => pdfInputRef.current?.click()} disabled={saving}>{selected.format === 'pdf' ? '替换 PDF' : '改用 PDF'}</Button>
            <Button variant="ghost" onClick={() => { const next = window.prompt('新的题面名称', selected.name); if (next) void patchSelected({ name: next }) }}>重命名</Button>
            <Button variant="ghost" onClick={() => patchSelected({ visibility: selected.visibility === 'public' ? 'private' : 'public' })}>{selected.visibility === 'public' ? '设为私有' : '设为公开'}</Button>
            <Button variant="ghost" onClick={remove} className={unifiedStyles.u15}>删除</Button>
          </div>}
          {editing ? <div><MarkdownEditor value={draft} onChange={setDraft} minHeight="480px" showPreview /><div className={unifiedStyles.u16}><Button variant="ghost" onClick={() => setEditing(false)}>取消</Button><Button variant="ghost" onClick={saveContent} disabled={saving}>{saving ? '保存中…' : '保存'}</Button></div></div>
            : selected.format === 'pdf' && selected.fileUrl ? <iframe src={selected.fileUrl} className={unifiedStyles.u17} />
            : <MarkdownRenderer content={selected.content || '暂无题面内容'} />}
        </>}
      </main>
      <FormDialog isOpen={createOpen} onClose={() => setCreateOpen(false)} title="创建题面版本" size="md" footer={<div className={unifiedStyles.u18}><Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button><Button variant="ghost" onClick={create} disabled={saving || !name.trim()}>{saving ? '创建中…' : '创建并编辑'}</Button></div>}>
        <div className={unifiedStyles.u19}>
          <div className={unifiedStyles.u20}>基于：{createMode === 'current' && selected ? `${selected.authorUsername || 'System'} / ${selected.name}` : '空白题面'}</div>
          <label>创建方式<Select value={createMode} onChange={event => setCreateMode(event.target.value as 'current' | 'blank')} className={unifiedStyles.u21}><option value="current">基于当前题面创建</option><option value="blank">创建空白题面</option></Select></label>
          <label>题面名称 *<Input value={name} onChange={event => setName(event.target.value)} maxLength={80} className={unifiedStyles.u22} /></label>
          <label>语言<Select value={language} onChange={event => setLanguage(event.target.value)} className={unifiedStyles.u21}><option value="zh">中文</option><option value="en">English</option></Select></label>
          <label>可见性<Select value={visibility} onChange={event => setVisibility(event.target.value as 'private' | 'public')} className={unifiedStyles.u21}><option value="private">私有</option><option value="public">公开</option></Select></label>
        </div>
      </FormDialog>
    </div>
  )
}
