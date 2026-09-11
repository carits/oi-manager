'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Library, Plus, Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { WorkspaceSummary } from '@oi-manager/shared'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormField } from '@/components/ui/FormField'
import { FormDialog } from '@/components/ui/Dialogs'
import { StatusBadge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { BLOG_VISIBILITY_LABELS, type BlogVisibility } from './blog-contract'
import styles from './BlogWorkspace.module.css'

type SeriesSummary = {
  id: string
  title: string
  description?: string | null
  visibility: BlogVisibility
  organizationId?: string | null
  revision: number
  entryCount: number
}

type SeriesDetails = SeriesSummary & {
  entries: Array<{
    orderIndex: number
    post: { id: string; status: string; currentVersion?: { title: string; version: number } | null; draft?: { title: string } | null }
  }>
}

const EMPTY_CREATE = { title: '', description: '', visibility: 'PRIVATE' as BlogVisibility, organizationId: '' }

export function BlogSeriesManager() {
  const router = useRouter()
  const toast = useToast()
  const [series, setSeries] = useState<SeriesSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [details, setDetails] = useState<SeriesDetails | null>(null)
  const [entries, setEntries] = useState<SeriesDetails['entries']>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<BlogVisibility>('PRIVATE')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState(EMPTY_CREATE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const orderSignature = useMemo(() => entries.map(entry => entry.post.id).join('|'), [entries])
  const savedOrderSignature = useMemo(() => details?.entries.map(entry => entry.post.id).join('|') || '', [details])
  const metadataDirty = Boolean(details && (title !== details.title || description !== (details.description || '') || visibility !== details.visibility))
  const orderDirty = Boolean(details && orderSignature !== savedOrderSignature)

  const loadList = useCallback(async () => {
    setLoading(true); setError('')
    const result = await apiClient.get<{ items: SeriesSummary[] }>('/api/blog-series?pageSize=100', { accountScoped: true })
    if (result.success && result.data) {
      setSeries(result.data.items)
      setSelectedId(current => current || result.data!.items[0]?.id || '')
    } else setError(result.message || '系列列表加载失败')
    setLoading(false)
  }, [])

  const loadDetails = useCallback(async (seriesId: string) => {
    if (!seriesId) { setDetails(null); setEntries([]); return }
    const result = await apiClient.get<SeriesDetails>(`/api/blog-series/${seriesId}`, { accountScoped: true })
    if (!result.success || !result.data) { setError(result.message || '系列详情加载失败'); return }
    setDetails(result.data); setEntries(result.data.entries); setTitle(result.data.title); setDescription(result.data.description || ''); setVisibility(result.data.visibility)
  }, [])

  useEffect(() => { void loadList(); void apiClient.get<{ workspaces: WorkspaceSummary[] }>('/api/workspaces', { accountScoped: true }).then(result => { if (result.success && result.data) setWorkspaces(result.data.workspaces.filter(item => item.type === 'organization')) }) }, [loadList])
  useEffect(() => { void loadDetails(selectedId) }, [loadDetails, selectedId])

  const createSeries = async () => {
    setSaving(true)
    const result = await apiClient.post<SeriesSummary>('/api/blog-series', { ...createForm, organizationId: createForm.organizationId || null }, { accountScoped: true })
    setSaving(false)
    if (!result.success || !result.data) return toast.error(result.message || '系列创建失败')
    setCreating(false); setCreateForm(EMPTY_CREATE); setSelectedId(result.data.id); toast.success('系列已创建'); await loadList()
  }

  const saveMetadata = async () => {
    if (!details) return
    setSaving(true)
    const result = await apiClient.patch<SeriesSummary>(`/api/blog-series/${details.id}`, { expectedRevision: details.revision, title, description: description || null, visibility }, { accountScoped: true })
    setSaving(false)
    if (!result.success || !result.data) return toast.error(result.message || '系列保存失败')
    toast.success('系列信息已保存'); await loadList(); await loadDetails(details.id)
  }

  const saveOrder = async () => {
    if (!details) return
    setSaving(true)
    const result = await apiClient.put<SeriesSummary>(`/api/blog-series/${details.id}/entries`, { expectedRevision: details.revision, postIds: entries.map(entry => entry.post.id) }, { accountScoped: true })
    setSaving(false)
    if (!result.success) return toast.error(result.message || '文章顺序保存失败')
    toast.success('文章顺序已保存'); await loadList(); await loadDetails(details.id)
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= entries.length) return
    setEntries(current => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next })
  }

  return <PageFrame width="reading"><div className={styles.stack}>
    <PageHeader title="博客系列" description="管理知识文章的有序阅读路径；重排使用 revision 乐观锁避免覆盖。" breadcrumbs={[{ label: '知识文章', href: '/personal/blogs' }, { label: '系列' }]} actions={<><Button variant="outline" icon={<ArrowLeft size={16} />} onClick={() => router.push('/personal/blogs')}>返回文章</Button><Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>新建系列</Button></>} />
    {error && <div className={styles.error} role="alert"><span>{error}</span><Button variant="outline" onClick={() => void loadList()}>重试</Button></div>}
    {!loading && !error && series.length === 0 ? <EmptyState icon={<Library size={32} />} title="还没有博客系列" description="创建系列后，在文章发布区选择它。" action={<Button onClick={() => setCreating(true)}>创建第一个系列</Button>} /> : series.length > 0 && <div className={styles.seriesLayout}>
      <nav className={styles.seriesList} aria-label="我的博客系列">{series.map(item => <Button key={item.id} variant={selectedId === item.id ? 'secondary' : 'ghost'} onClick={() => setSelectedId(item.id)}><span>{item.title}</span><small>{item.entryCount} 篇</small></Button>)}</nav>
      {details && <section className={styles.editorCard}>
        <div className={styles.formGrid}><FormField label="系列名称"><Input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} /></FormField><FormField label="可见范围"><Select value={visibility} onChange={event => setVisibility(event.target.value as BlogVisibility)}>{(details.organizationId ? ['PRIVATE', 'ORGANIZATION'] : ['PRIVATE', 'UNLISTED', 'PLATFORM', 'PUBLIC']).map(value => <option key={value} value={value}>{BLOG_VISIBILITY_LABELS[value as BlogVisibility]}</option>)}</Select></FormField><FormField label="系列说明"><Textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} maxLength={1000} /></FormField></div>
        <div className={styles.seriesActions}><StatusBadge variant="neutral">{metadataDirty ? '有未保存修改' : '已保存'}</StatusBadge><Button icon={<Save size={16} />} loading={saving} disabled={!metadataDirty} onClick={() => void saveMetadata()}>保存系列信息</Button></div>
        <div className={styles.referenceSection}><h2>文章顺序</h2>{entries.length === 0 ? <p className={styles.muted}>还没有文章。请在文章草稿中选择本系列并发布。</p> : <div className={styles.seriesEntries}>{entries.map((entry, index) => <article key={entry.post.id}><div><strong>{index + 1}. {entry.post.currentVersion?.title || entry.post.draft?.title || '未命名文章'}</strong><small>{entry.post.status}{entry.post.currentVersion ? ` · V${entry.post.currentVersion.version}` : ''}</small></div><div><Button size="sm" variant="ghost" aria-label="上移文章" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></Button><Button size="sm" variant="ghost" aria-label="下移文章" disabled={index === entries.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></Button><Button size="sm" variant="outline" onClick={() => router.push(`/personal/blogs/${entry.post.id}`)}>打开</Button></div></article>)}</div>}<Button variant="outline" loading={saving} disabled={!orderDirty} onClick={() => void saveOrder()}>保存文章顺序</Button></div>
      </section>}
    </div>}
    <FormDialog isOpen={creating} onClose={() => setCreating(false)} onSubmit={() => void createSeries()} title="新建博客系列" description="系列名称在归属范围内按 NFKC 规范化后唯一。" submitText="创建系列" loading={saving} dirty={Boolean(createForm.title || createForm.description)} submitDisabled={!createForm.title.trim()}><div className={styles.formGrid}><FormField label="系列名称" required><Input value={createForm.title} onChange={event => setCreateForm(current => ({ ...current, title: event.target.value }))} maxLength={120} /></FormField><FormField label="归属"><Select value={createForm.organizationId} onChange={event => setCreateForm(current => ({ ...current, organizationId: event.target.value, visibility: event.target.value ? 'ORGANIZATION' : 'PRIVATE' }))}><option value="">个人系列</option>{workspaces.map(item => <option key={item.organizationId} value={item.organizationId}>{item.organizationName}</option>)}</Select></FormField><FormField label="可见范围"><Select value={createForm.visibility} onChange={event => setCreateForm(current => ({ ...current, visibility: event.target.value as BlogVisibility }))}>{(createForm.organizationId ? ['PRIVATE', 'ORGANIZATION'] : ['PRIVATE', 'UNLISTED', 'PLATFORM', 'PUBLIC']).map(value => <option key={value} value={value}>{BLOG_VISIBILITY_LABELS[value as BlogVisibility]}</option>)}</Select></FormField><FormField label="系列说明"><Textarea value={createForm.description} onChange={event => setCreateForm(current => ({ ...current, description: event.target.value }))} rows={4} maxLength={1000} /></FormField></div></FormDialog>
  </div></PageFrame>
}
