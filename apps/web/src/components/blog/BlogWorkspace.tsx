'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArrowLeft, BookOpenCheck, FolderPlus, History, Save, Send } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import type { WorkspaceSummary } from '@oi-manager/shared'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { FormField } from '@/components/ui/FormField'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { StatusBadge } from '@/components/ui/Badge'
import { Tabs } from '@/components/ui/Tabs'
import { ConfirmDialog, FormDialog } from '@/components/ui/Dialogs'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/components/AuthProvider'
import { BlogReferenceEditor } from './BlogReferenceEditor'
import { BlogCommunityPanel } from './BlogCommunityPanel'
import { BlogClassificationView, BlogReferenceCards, type PublishedBlogReference } from './BlogPublishedMetadata'
import {
  BLOG_TYPE_LABELS,
  BLOG_VISIBILITY_LABELS,
  EMPTY_BLOG_CLASSIFICATION,
  emptyBlogReference,
  validateBlogDraft,
  type BlogDraftReference,
  type BlogDraftClassification,
  type BlogClassificationSnapshot,
  type BlogPostType,
  type BlogVisibility,
} from './blog-contract'
import styles from './BlogWorkspace.module.css'
import { useUnsavedChanges } from '@/components/navigation/UnsavedChangesProvider'

type BlogVersion = {
  id: string
  version: number
  title: string
  summary?: string | null
  contentMarkdown: string
  contentHash: string
  status: string
  publishedAt: string
  references: PublishedBlogReference[]
  classification: BlogClassificationSnapshot
}

type BlogPost = {
  id: string
  slug: string
  type: BlogPostType
  status: string
  visibility: BlogVisibility
  organizationId?: string | null
  author: { id: string; username: string }
  currentVersion?: BlogVersion | null
  draft?: { revision: number; title: string; summary?: string | null; contentMarkdown: string; references: BlogDraftReference[]; classification?: BlogDraftClassification; baseVersionId?: string | null } | null
}

type VersionSummary = Pick<BlogVersion, 'id' | 'version' | 'title' | 'summary' | 'contentHash' | 'status' | 'publishedAt'> & { classification?: BlogClassificationSnapshot }

type DraftState = { title: string; summary: string; contentMarkdown: string; references: BlogDraftReference[]; classification: BlogDraftClassification }

const EMPTY_DRAFT: DraftState = { title: '', summary: '', contentMarkdown: '', references: [], classification: EMPTY_BLOG_CLASSIFICATION }

function serializeEditorState(input: { type: BlogPostType; slug: string; organizationId: string; visibility: BlogVisibility; draft: DraftState }) {
  return JSON.stringify(input)
}

type BlogSeriesSummary = { id: string; title: string; visibility: BlogVisibility; organizationId?: string | null; revision: number; entryCount: number }
type BlogTagSummary = { id: string; kind: 'SYSTEM' | 'USER'; name: string }

function initialReference(search: URLSearchParams): BlogDraftReference[] {
  const problemId = search.get('problemId')
  const problemRevisionId = search.get('problemRevisionId')
  const solutionVersionId = search.get('solutionVersionId')
  const standingSnapshotId = search.get('standingSnapshotId')
  const ratingChangeId = search.get('ratingChangeId')
  if (problemId && problemRevisionId) return [{ ...emptyBlogReference('PROBLEM_REVISION'), problemId, problemRevisionId, relationType: 'PRIMARY_SUBJECT' }]
  if (problemId) return [{ ...emptyBlogReference('PROBLEM'), problemId, relationType: 'PRIMARY_SUBJECT' }]
  if (solutionVersionId) return [{ ...emptyBlogReference('SOLUTION_VERSION'), solutionVersionId, relationType: 'SOURCE' }]
  if (standingSnapshotId) return [{ ...emptyBlogReference('CONTEST_STANDING'), standingSnapshotId, relationType: 'PRIMARY_SUBJECT' }]
  if (ratingChangeId) return [{ ...emptyBlogReference('RATING_CHANGE'), ratingChangeId, relationType: 'RESULT' }]
  return []
}

export function BlogWorkspace({ postId }: { postId?: string }) {
  const searchParams = useSearchParams()
  const toast = useToast()
  const { user } = useAuth()
  const initialDraft = useRef<DraftState>({ ...EMPTY_DRAFT, classification: { ...EMPTY_BLOG_CLASSIFICATION }, references: initialReference(new URLSearchParams(searchParams.toString())) })
  const [post, setPost] = useState<BlogPost | null>(null)
  const [draft, setDraft] = useState<DraftState>(initialDraft.current)
  const [baseline, setBaseline] = useState(() => serializeEditorState({ type: 'ARTICLE', slug: '', organizationId: '', visibility: 'PRIVATE', draft: initialDraft.current }))
  const [type, setType] = useState<BlogPostType>('ARTICLE')
  const [slug, setSlug] = useState('')
  const [organizationId, setOrganizationId] = useState('')
  const [visibility, setVisibility] = useState<BlogVisibility>('PRIVATE')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [series, setSeries] = useState<BlogSeriesSummary[]>([])
  const [tagSuggestions, setTagSuggestions] = useState<BlogTagSummary[]>([])
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [historyVersion, setHistoryVersion] = useState<BlogVersion | null>(null)
  const [tab, setTab] = useState<'draft' | 'published' | 'versions'>(postId ? 'published' : 'draft')
  const [loading, setLoading] = useState(Boolean(postId))
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [seriesDialogOpen, setSeriesDialogOpen] = useState(false)
  const [seriesTitle, setSeriesTitle] = useState('')
  const [seriesDescription, setSeriesDescription] = useState('')
  const [seriesVisibility, setSeriesVisibility] = useState<BlogVisibility>('PRIVATE')
  const [error, setError] = useState('')
  const serializedEditorState = useMemo(() => serializeEditorState({ type, slug, organizationId, visibility, draft }), [draft, organizationId, slug, type, visibility])
  const dirty = baseline !== serializedEditorState
  const { requestNavigation } = useUnsavedChanges(`blog-editor:${postId || 'new'}`, dirty)

  const applyPost = useCallback((value: BlogPost) => {
    setPost(value); setType(value.type); setSlug(value.slug); setOrganizationId(value.organizationId || ''); setVisibility(value.visibility)
    if (value.draft) {
      const next = { title: value.draft.title, summary: value.draft.summary || '', contentMarkdown: value.draft.contentMarkdown, references: value.draft.references || [], classification: value.draft.classification || { ...EMPTY_BLOG_CLASSIFICATION } }
      setDraft(next); setBaseline(serializeEditorState({ type: value.type, slug: value.slug, organizationId: value.organizationId || '', visibility: value.visibility, draft: next }))
    }
  }, [])

  const load = useCallback(async () => {
      if (!postId) return
    setLoading(true); setError('')
    const [postResult, versionResult] = await Promise.all([
      apiClient.get<BlogPost>(`/api/blogs/${postId}`, { accountScoped: true }),
      apiClient.get<VersionSummary[]>(`/api/blogs/${postId}/versions`, { accountScoped: true }),
    ])
    if (postResult.success && postResult.data) applyPost(postResult.data)
    else setError(postResult.message || '文章加载失败')
    if (versionResult.success && versionResult.data) setVersions(versionResult.data)
    setLoading(false)
  }, [applyPost, postId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    void Promise.all([
      apiClient.get<{ workspaces: WorkspaceSummary[] }>('/api/workspaces', { accountScoped: true }),
      apiClient.get<{ items: BlogSeriesSummary[] }>('/api/blog-series?pageSize=100', { accountScoped: true }),
      apiClient.get<{ items: BlogTagSummary[] }>('/api/blog-tags', { accountScoped: true }),
    ]).then(([workspaceResult, seriesResult, tagResult]) => {
      if (workspaceResult.success && workspaceResult.data) setWorkspaces(workspaceResult.data.workspaces.filter(item => item.type === 'organization'))
      if (seriesResult.success && seriesResult.data) setSeries(seriesResult.data.items)
      if (tagResult.success && tagResult.data) setTagSuggestions(tagResult.data.items)
    })
  }, [])
  const persistDraft = async (): Promise<{ id: string; revision: number } | null> => {
    const validation = validateBlogDraft(draft)
    if (validation) { toast.error(validation); setTab('draft'); return null }
    setSaving(true)
    try {
      if (!post) {
        const result = await apiClient.post<BlogPost>('/api/blogs', {
          ...(slug.trim() ? { slug: slug.trim() } : {}), type, organizationId: organizationId || null,
          title: draft.title, summary: draft.summary || null, contentMarkdown: draft.contentMarkdown, references: draft.references, classification: draft.classification,
        }, { accountScoped: true })
        if (!result.success || !result.data?.draft) { toast.error(result.message || '草稿创建失败'); return null }
        applyPost(result.data)
        window.history.replaceState(null, '', `/personal/blogs/${result.data.id}`)
        return { id: result.data.id, revision: result.data.draft.revision }
      }
      if (!dirty && post.draft) return { id: post.id, revision: post.draft.revision }
      const result = await apiClient.patch<{ revision: number; title: string; summary?: string | null; contentMarkdown: string; references: BlogDraftReference[]; classification: BlogDraftClassification }>(`/api/blogs/${post.id}/draft`, {
        expectedRevision: post.draft?.revision, title: draft.title, summary: draft.summary || null, contentMarkdown: draft.contentMarkdown, references: draft.references, classification: draft.classification,
      }, { accountScoped: true })
      if (!result.success || !result.data) { toast.error(result.message || '草稿保存失败'); return null }
      const next = { title: result.data.title, summary: result.data.summary || '', contentMarkdown: result.data.contentMarkdown, references: result.data.references || [], classification: result.data.classification || { ...EMPTY_BLOG_CLASSIFICATION } }
      setDraft(next); setBaseline(serializeEditorState({ type, slug, organizationId, visibility, draft: next })); setPost(current => current ? { ...current, draft: { ...current.draft!, ...result.data! } } : current)
      return { id: post.id, revision: result.data.revision }
    } finally { setSaving(false) }
  }

  const save = async () => { const result = await persistDraft(); if (result) toast.success('草稿已保存') }
  const publish = async () => {
    setPublishing(true)
    try {
      const saved = await persistDraft()
      if (!saved) return
      const result = await apiClient.post<BlogPost>(`/api/blogs/${saved.id}/publish`, { expectedDraftRevision: saved.revision, visibility }, { accountScoped: true })
      if (!result.success || !result.data) return toast.error(result.message || '发布失败')
      applyPost(result.data); setVersions([]); setTab('published'); toast.success(`已发布 V${result.data.currentVersion?.version || ''}`)
      const versionsResult = await apiClient.get<VersionSummary[]>(`/api/blogs/${saved.id}/versions`, { accountScoped: true })
      if (versionsResult.success && versionsResult.data) setVersions(versionsResult.data)
    } finally { setPublishing(false) }
  }

  const openVersion = async (versionId: string) => {
    if (!post) return
    const result = await apiClient.get<BlogVersion>(`/api/blogs/${post.id}/versions/${versionId}`, { accountScoped: true })
    if (result.success && result.data) setHistoryVersion(result.data); else toast.error(result.message || '版本加载失败')
  }

  const archive = async () => {
    if (!post) return
    setSaving(true)
    const result = await apiClient.post(`/api/blogs/${post.id}/archive`, undefined, { accountScoped: true })
    setSaving(false); setArchiveOpen(false)
    if (result.success) { toast.success('文章已归档'); requestNavigation('/personal/blogs') } else toast.error(result.message || '归档失败')
  }

  const createSeries = async () => {
    if (!seriesTitle.trim()) return toast.error('请填写系列名称')
    setSaving(true)
    const result = await apiClient.post<BlogSeriesSummary>('/api/blog-series', {
      title: seriesTitle,
      description: seriesDescription || null,
      visibility: seriesVisibility,
      organizationId: organizationId || null,
    }, { accountScoped: true })
    setSaving(false)
    if (!result.success || !result.data) return toast.error(result.message || '系列创建失败')
    setSeries(current => [result.data!, ...current])
    setDraft(current => ({ ...current, classification: { ...current.classification, seriesId: result.data!.id } }))
    setSeriesDialogOpen(false); setSeriesTitle(''); setSeriesDescription('')
    toast.success('系列已创建并选中')
  }

  const selectedTags = new Set(draft.classification.tagIds)
  const toggleTag = (tagId: string) => setDraft(current => ({
    ...current,
    classification: {
      ...current.classification,
      tagIds: current.classification.tagIds.includes(tagId)
        ? current.classification.tagIds.filter(id => id !== tagId)
        : [...current.classification.tagIds, tagId],
    },
  }))

  if (loading) return <PageFrame width="reading"><p className={styles.loading}>正在加载知识文章…</p></PageFrame>
  if (error) return <PageFrame width="reading"><div className={styles.error} role="alert"><span>{error}</span><Button variant="outline" onClick={() => void load()}>重试</Button></div></PageFrame>
  const isAuthor = !post || post.author.id === user?.userId
  const editable = isAuthor && (!post || Boolean(post.draft))

  return <PageFrame width="reading"><div className={styles.stack}>
    <PageHeader title={post?.currentVersion?.title || draft.title || '新建知识文章'} description={post ? `/${post.slug} · ${BLOG_TYPE_LABELS[post.type]}` : '草稿不会公开；发布时才解析引用并执行可见范围校验。'} breadcrumbs={[{ label: '知识文章', href: '/personal/blogs' }, { label: post ? '文章' : '新建' }]} actions={<><Button variant="outline" icon={<ArrowLeft size={16} />} onClick={() => requestNavigation('/personal/blogs')}>返回列表</Button>{post && isAuthor && <Button variant="danger" icon={<Archive size={16} />} onClick={() => setArchiveOpen(true)}>归档</Button>}</>} />
    {post && <Tabs value={tab} onChange={setTab} items={[{ value: 'published', label: '当前版本', disabled: !post.currentVersion }, { value: 'draft', label: '编辑草稿', disabled: !editable }, { value: 'versions', label: '版本历史', count: versions.length }]} />}

    {tab === 'draft' && editable && <>
      {!post && <section className={styles.metadataGrid}>
        <FormField label="文章类型"><Select value={type} onChange={event => setType(event.target.value as BlogPostType)}>{Object.entries(BLOG_TYPE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></FormField>
        <FormField label="文章地址" hint="可留空，由系统生成；创建后不可更改。"><Input value={slug} onChange={event => setSlug(event.target.value)} placeholder="lowercase-slug" /></FormField>
        <FormField label="所属组织" hint="只有选择组织后，才能发布为组织可见。"><Select value={organizationId} onChange={event => setOrganizationId(event.target.value)}><option value="">个人文章</option>{workspaces.map(item => <option key={item.organizationId} value={item.organizationId}>{item.organizationName}</option>)}</Select></FormField>
      </section>}
      <section className={styles.editorCard}>
        <div className={styles.formGrid}><FormField label="标题" required><Input value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} maxLength={160} /></FormField><FormField label="摘要"><Textarea value={draft.summary} onChange={event => setDraft(current => ({ ...current, summary: event.target.value }))} rows={3} maxLength={1000} /></FormField></div>
        <div><strong className={styles.fieldTitle}>正文</strong><MarkdownEditor value={draft.contentMarkdown} onChange={contentMarkdown => setDraft(current => ({ ...current, contentMarkdown }))} minHeight="460px" showPreview securityProfile="knowledge" /></div>
      </section>
      <section className={styles.editorCard}><BlogReferenceEditor value={draft.references} onChange={references => setDraft(current => ({ ...current, references }))} /></section>
      <section className={styles.editorCard}>
        <div className={styles.referenceHeading}><div><strong>系列与标签</strong><p>系列保存文章顺序；系统标签全平台受控，作者标签每篇最多 5 个。</p></div><Button variant="outline" icon={<FolderPlus size={16} />} onClick={() => { setSeriesVisibility(organizationId ? 'ORGANIZATION' : visibility); setSeriesDialogOpen(true) }}>新建系列</Button></div>
        <div className={styles.classificationGrid}>
          <FormField label="所属系列"><Select value={draft.classification.seriesId || ''} onChange={event => setDraft(current => ({ ...current, classification: { ...current.classification, seriesId: event.target.value || null } }))}><option value="">不加入系列</option>{series.filter(item => (item.organizationId || '') === organizationId && item.visibility === visibility).map(item => <option key={item.id} value={item.id}>{item.title}（{item.entryCount} 篇）</option>)}</Select></FormField>
          <FormField label="作者标签" hint="使用逗号分隔；与系统标签同名时自动使用系统标签。"><Input value={draft.classification.authorTags.join(', ')} onChange={event => setDraft(current => ({ ...current, classification: { ...current.classification, authorTags: event.target.value.split(/[,，]/).map(item => item.trim()).filter(Boolean) } }))} placeholder="学习笔记, NOI 复习" /></FormField>
        </div>
        {tagSuggestions.length > 0 && <div className={styles.tagPicker}><span>已有标签：</span>{tagSuggestions.map(tag => <Button key={tag.id} size="sm" variant={selectedTags.has(tag.id) ? 'secondary' : 'ghost'} onClick={() => toggleTag(tag.id)}>{tag.name}{tag.kind === 'SYSTEM' ? ' · 系统' : ''}</Button>)}</div>}
      </section>
      <div className={styles.publishBar}><div><FormField label="发布范围"><Select value={visibility} onChange={event => setVisibility(event.target.value as BlogVisibility)}>{Object.entries(BLOG_VISIBILITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></FormField><small>公开范围不得超过任一结构化引用的可见范围；服务端会 fail-closed。</small></div><div><Button variant="outline" icon={<Save size={16} />} loading={saving} onClick={() => void save()}>保存草稿</Button><Button icon={<Send size={16} />} loading={publishing} onClick={() => void publish()}>发布不可变版本</Button></div></div>
    </>}

    {tab === 'published' && post?.currentVersion && <section className={styles.reader}>
      <header><div><StatusBadge variant="success">V{post.currentVersion.version} · 当前</StatusBadge><StatusBadge variant="neutral">{BLOG_VISIBILITY_LABELS[post.visibility]}</StatusBadge></div><time>{new Date(post.currentVersion.publishedAt).toLocaleString('zh-CN')}</time></header>
      {post.currentVersion.summary && <p className={styles.lead}>{post.currentVersion.summary}</p>}
      <BlogClassificationView classification={post.currentVersion.classification} />
      <MarkdownRenderer content={post.currentVersion.contentMarkdown} securityProfile="knowledge" />
      <div className={styles.referenceSection}><h2>固定引用</h2><BlogReferenceCards references={post.currentVersion.references} /></div>
      <BlogCommunityPanel postId={post.id} />
    </section>}

    {tab === 'versions' && post && <section className={styles.historyLayout}>
      <div className={styles.versionList}>{versions.map(version => <Button key={version.id} variant={historyVersion?.id === version.id ? 'secondary' : 'ghost'} onClick={() => void openVersion(version.id)}><History size={15} />V{version.version} · {version.title} · {version.status}</Button>)}</div>
      <article className={styles.reader}>{historyVersion ? <><header><StatusBadge variant={historyVersion.status === 'CURRENT' ? 'success' : 'neutral'}>V{historyVersion.version} · {historyVersion.status}</StatusBadge><time>{new Date(historyVersion.publishedAt).toLocaleString('zh-CN')}</time></header><BlogClassificationView classification={historyVersion.classification} /><MarkdownRenderer content={historyVersion.contentMarkdown} securityProfile="knowledge" /><div className={styles.referenceSection}><h2>该版本的固定引用</h2><BlogReferenceCards references={historyVersion.references} /></div></> : <div className={styles.historyEmpty}><BookOpenCheck size={28} /><p>选择一个版本查看不可变正文和当时的引用。</p></div>}</article>
    </section>}
    <ConfirmDialog isOpen={archiveOpen} onClose={() => setArchiveOpen(false)} onConfirm={() => void archive()} title="归档这篇文章？" message="归档后不会出现在反向索引中，固定版本仍保留用于审计。" confirmText="确认归档" danger loading={saving} />
    <FormDialog isOpen={seriesDialogOpen} onClose={() => setSeriesDialogOpen(false)} onSubmit={() => void createSeries()} title="新建博客系列" description="系列与文章使用相同归属和可见范围，防止目录泄露。" submitText="创建并选中" loading={saving} dirty={Boolean(seriesTitle || seriesDescription)} submitDisabled={!seriesTitle.trim()}><div className={styles.formGrid}><FormField label="系列名称" required><Input value={seriesTitle} onChange={event => setSeriesTitle(event.target.value)} maxLength={120} /></FormField><FormField label="可见范围"><Select value={seriesVisibility} onChange={event => setSeriesVisibility(event.target.value as BlogVisibility)}>{(organizationId ? ['PRIVATE', 'ORGANIZATION'] : ['PRIVATE', 'UNLISTED', 'PLATFORM', 'PUBLIC']).map(item => <option key={item} value={item}>{BLOG_VISIBILITY_LABELS[item as BlogVisibility]}</option>)}</Select></FormField><FormField label="系列说明"><Textarea value={seriesDescription} onChange={event => setSeriesDescription(event.target.value)} rows={4} maxLength={1000} /></FormField></div></FormDialog>
  </div></PageFrame>
}
