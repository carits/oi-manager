'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import unifiedStyles from './ProblemListDetailPage.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { usePathname, useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { currentWorkspacePrefix, isPersonalPath } from '@/lib/workspacePath'
import { DetailDialog, FormDialog } from '@/components/ui/Dialogs'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { OJ_PLATFORMS_NO_ALL } from '@/lib/oj-platforms'
import { getAssetUrl } from '@/lib/assets'
import { AlertTriangle, Edit3, Send, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Empty } from '@/components/ui/Empty'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { Toolbar, ToolbarGroup } from '@/components/ui/Toolbar'
import styles from './ProblemListDetail.module.css'

const MarkdownRenderer = dynamic(
  () => import('@/components/ui/MarkdownRenderer').then(module => module.MarkdownRenderer),
  { loading: () => <SkeletonRegion rows={4} label="题面正在排版" /> },
)

// ==================== 类型定义 ====================

export interface EntryInfo {
  id: string
  sectionId: string
  problemId: string
  sortOrder: number
  alias: string | null
  notes: string | null
  ojName: string | null
  Problem: {
    id: string
    platform: string
    problemId: string
    title: string
    difficulty: string | null
    ojBindings: string | null
  }
}

export interface SectionInfo {
  id: string
  problemListId: string
  title: string
  sortOrder: number
  Entries: EntryInfo[]
}

export interface ShareInfo {
  id: string
  targetType: string
  targetId: string
  permission: string
  targetName: string
  targetAvatar: string | null
  targetUsername: string
}

export interface ListDetail {
  id: string
  title: string
  description: string | null
  ownerId: string
  visibility: string
  updatedAt: string
  Sections: SectionInfo[]
  Shares: ShareInfo[]
  _permission: string
}

interface ContextProblem {
  id: string
  title: string
  difficulty: string | null
  timeLimit: number | null
  memoryLimit: number | null
  description: string | null
  statementPdfUrl: string | null
  statements: Array<{ id: string; format: string; language: string | null; content: string | null; fileUrl: string | null }>
  attachments: Array<{ id: string; fileName: string; fileSize: number; description: string | null; fileUrl: string | null }>
}

// ==================== 工具函数 ====================

function getOjPlatformLabel(ojBindings: string | null, ojName?: string | null): string {
  // 优先使用条目存储的 ojName
  if (ojName) {
    const found = OJ_PLATFORMS_NO_ALL.find(oj => oj.value === ojName)
    return found?.label || ojName
  }
  if (!ojBindings) return '-'
  try {
    const bindings = JSON.parse(ojBindings)
    if (Array.isArray(bindings) && bindings.length > 0) {
      return bindings.map((b: any) => {
        const found = OJ_PLATFORMS_NO_ALL.find(oj => oj.value === b.platform)
        return found?.label || b.platform
      }).join(', ')
    }
  } catch { /* skip */ }
  return '-'
}

// ==================== 新行类型 ====================

interface NewRow {
  id: string
  sectionId: string
  ojName: string
  problemCode: string
  alias: string
  notes: string
  resolving: boolean
  resolved: {
    found: boolean
    problemId: string
    title: string
    created: boolean
  } | null
  saving: boolean
}

let tempIdCounter = 0

// ==================== 主组件 ====================

interface ProblemListDetailPageProps {
  listIdOverride?: string
}

export default function ProblemListDetailPage({ listIdOverride }: ProblemListDetailPageProps = {}) {
  const router = useRouter()
  const params = useParams()
  const pathname = usePathname()
  const { user } = useAuth()
  const listId = listIdOverride || (params.id as string)
  const pathPrefix = currentWorkspacePrefix(pathname, user?.role === 'platform_admin' ? '/platform-admin' : '/personal')

  const [detail, setDetail] = useState<ListDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  const [showSharePanel, setShowSharePanel] = useState(false)

  const [newRows, setNewRows] = useState<NewRow[]>([])
  const [deleteEntryConfirm, setDeleteEntryConfirm] = useState<string | null>(null)
  const [deleteSectionConfirm, setDeleteSectionConfirm] = useState<string | null>(null)

  const [editingEntry, setEditingEntry] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState('')

  const [editingSection, setEditingSection] = useState<string | null>(null)
  const [sectionTitleDraft, setSectionTitleDraft] = useState('')

  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [showNewSection, setShowNewSection] = useState(false)

  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

  const [showPublishModal, setShowPublishModal] = useState(false)
  const [contextEntryId, setContextEntryId] = useState<string | null>(null)
  const [contextProblem, setContextProblem] = useState<ContextProblem | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)

  const canEdit = detail?._permission === 'admin' || detail?._permission === 'edit'
  const isAdmin = detail?._permission === 'admin'
  const isStudentView = user?.role === 'student' && !isPersonalPath(pathname)

  useEffect(() => { fetchDetail() }, [listId])

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get<ListDetail>(`/api/problem-lists/${listId}`)
      if (res.success && res.data) {
        const data = res.data as any
        setDetail({
          ...data,
          Sections: (data.Sections || data.sections || data.ProblemListSection || []).map((s: any) => ({
            ...s,
            Entries: s.Entries || s.ProblemListEntry || [],
          })),
          Shares: data.Shares || data.shares || data.ProblemListShare || [],
        })
      }
    } catch (e) {
      console.error('Failed', e)
    } finally {
      setLoading(false)
    }
  }, [listId])

  // ---------- 新行操作 ----------

  const getLastOjPlatform = () => {
    // 1. 优先用 localStorage 记住的
    const saved = localStorage.getItem('lastOjPlatform')
    if (saved) return saved
    // 2. 从当前题单已有条目中找最后一个 ojName
    if (detail?.Sections) {
      const allEntries = detail.Sections.flatMap(s => s.Entries)
      for (let i = allEntries.length - 1; i >= 0; i--) {
        if (allEntries[i].ojName) return allEntries[i].ojName!
      }
    }
    return 'carits'
  }

  const addNewRow = (sectionId: string) => {
    const row: NewRow = {
      id: `temp-${++tempIdCounter}`,
      sectionId,
      ojName: getLastOjPlatform(),
      problemCode: '',
      alias: '',
      notes: '',
      resolving: false,
      resolved: null,
      saving: false,
    }
    setNewRows(prev => [...prev, row])
  }

  const updateNewRow = (rowId: string, updates: Partial<NewRow>) => {
    setNewRows(prev => prev.map(r => r.id === rowId ? { ...r, ...updates } : r))
    if (updates.ojName) localStorage.setItem('lastOjPlatform', updates.ojName)
  }

  const removeNewRow = (rowId: string) => {
    setNewRows(prev => prev.filter(r => r.id !== rowId))
  }

  const resolveTimerRef = useRef<Record<string, NodeJS.Timeout>>({})

  const handleResolveRow = (row: NewRow) => {
    if (resolveTimerRef.current[row.id]) clearTimeout(resolveTimerRef.current[row.id])
    if (!row.problemCode.trim()) {
      updateNewRow(row.id, { resolved: null, resolving: false })
      return
    }
    updateNewRow(row.id, { resolving: true })
    resolveTimerRef.current[row.id] = setTimeout(async () => {
      try {
        const res = await apiClient.post(`/api/problem-lists/${listId}/entries/resolve`, {
          items: [{ ojName: row.ojName, problemCode: row.problemCode.trim() }]
        })
        if (res.success && res.data) {
          const resolved = (res.data as any).resolved
          if (resolved && resolved.length > 0) {
            updateNewRow(row.id, { resolved: resolved[0], resolving: false })
          }
        }
      } catch {
        updateNewRow(row.id, { resolving: false })
      }
    }, 500)
  }

  /** 批量保存某章节所有已解析的新行 */
  const saveAllSectionRows = async (sectionId: string) => {
    const rowsToSave = newRows.filter(r => r.sectionId === sectionId && r.resolved?.found && !r.saving)
    if (rowsToSave.length === 0) return

    // 标记所有行为 saving
    for (const row of rowsToSave) {
      updateNewRow(row.id, { saving: true })
    }

    let saved = 0
    for (const row of rowsToSave) {
      try {
        const body: any = {
          ojName: row.ojName, problemCode: row.problemCode.trim(),
          alias: row.alias.trim() || null, notes: row.notes.trim() || null,
        }
        if (row.resolved!.problemId) body.problemId = row.resolved!.problemId
        const res = await apiClient.post(`/api/problem-lists/sections/${row.sectionId}/entries/single`, body)
        if (res.success || (res as any).status === 409) {
          removeNewRow(row.id)
          saved++
        } else {
          updateNewRow(row.id, { saving: false })
        }
      } catch {
        updateNewRow(row.id, { saving: false })
      }
    }

    if (saved > 0) fetchDetail()
  }

  // ---------- 已有条目操作 ----------

  const handleDeleteEntry = async (entryId: string) => {
    await apiClient.delete(`/api/problem-lists/entries/${entryId}`)
    setDeleteEntryConfirm(null)
    fetchDetail()
  }

  const handleUpdateEntry = async (entryId: string, data: { alias?: string | null; notes?: string | null }) => {
    const res = await apiClient.put(`/api/problem-lists/entries/${entryId}`, {
      ...data,
      expectedUpdatedAt: detail?.updatedAt,
    })
    if ((res as any).status === 409) {
      toast.warning('题单已被其他人修改，已自动刷新')
      fetchDetail()
      return
    }
    setEditingEntry(null)
    fetchDetail()
  }

  const handleMoveEntry = async (sectionId: string, entryId: string, direction: 'up' | 'down') => {
    if (!detail) return
    const section = detail.Sections.find(s => s.id === sectionId)
    if (!section) return
    const entries = section.Entries
    const idx = entries.findIndex(e => e.id === entryId)
    if (idx < 0) return
    if (direction === 'up' && idx === 0) return
    if (direction === 'down' && idx === entries.length - 1) return
    const newOrder = [...entries]
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    ;[newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]]
    await apiClient.put(`/api/problem-lists/sections/${sectionId}/entries/reorder`, { entryIds: newOrder.map(e => e.id) })
    fetchDetail()
  }

  // ---------- 章节操作 ----------

  const handleAddSection = async () => {
    if (!newSectionTitle.trim()) return
    await apiClient.post(`/api/problem-lists/${listId}/sections`, { title: newSectionTitle.trim() })
    setNewSectionTitle('')
    setShowNewSection(false)
    fetchDetail()
  }

  const handleRenameSection = async (sectionId: string) => {
    if (!sectionTitleDraft.trim()) return
    const res = await apiClient.put(`/api/problem-lists/sections/${sectionId}`, {
      title: sectionTitleDraft.trim(),
      expectedUpdatedAt: detail?.updatedAt,
    })
    if ((res as any).status === 409) {
      toast.warning('题单已被其他人修改，已自动刷新')
      fetchDetail()
      return
    }
    setEditingSection(null)
    fetchDetail()
  }

  const handleDeleteSection = async (sectionId: string) => {
    await apiClient.delete(`/api/problem-lists/sections/${sectionId}`)
    setDeleteSectionConfirm(null)
    fetchDetail()
  }

  // ---------- 标题编辑 ----------

  const handleSaveTitle = async () => {
    if (!titleDraft.trim()) return
    const res = await apiClient.put(`/api/problem-lists/${listId}`, {
      title: titleDraft.trim(),
      expectedUpdatedAt: detail?.updatedAt,
    })
    if ((res as any).status === 409) {
      toast.warning('题单已被其他人修改，已自动刷新')
      fetchDetail()
      return
    }
    setEditingTitle(false)
    fetchDetail()
  }

  const totalEntries = detail?.Sections.reduce((sum, s) => sum + s.Entries.length, 0) || 0

  const openContextProblem = async (entryId: string) => {
    setContextEntryId(entryId)
    setContextProblem(null)
    setContextError(null)
    setContextLoading(true)
    try {
      const response = await apiClient.get<ContextProblem>(`/api/problem-lists/${listId}/entries/${entryId}/problem`)
      if (response.success && response.data) setContextProblem(response.data)
      else setContextError(response.message || '题面暂时不可用')
    } catch (error: any) {
      setContextError(error?.message || '题面暂时不可用')
    } finally {
      setContextLoading(false)
    }
  }

  const closeContextProblem = () => {
    setContextEntryId(null)
    setContextProblem(null)
    setContextError(null)
  }

  // ==================== 渲染 ====================

  if (loading) return <PageFrame width="workbench"><PageHeader title="题单详情" breadcrumbs={[{ label: '题单', href: `${pathPrefix}/problem-lists` }, { label: '详情' }]} /><SkeletonRegion rows={7} label="题单详情正在准备" /></PageFrame>
  if (!detail) return <PageFrame><PageHeader title="题单详情" breadcrumbs={[{ label: '题单', href: `${pathPrefix}/problem-lists` }, { label: '详情' }]} /><Empty title="题单不存在或无权访问" description="题单可能已删除，或当前账号没有查看权限。" /></PageFrame>

  return (
    <>
      <PageFrame width="workbench">
        <PageHeader
          title={detail.title}
          description={detail.description || `${detail.Sections.length} 个章节，共 ${totalEntries} 题`}
          breadcrumbs={[{ label: '题单', href: `${pathPrefix}/problem-lists` }, { label: detail.title }]}
          actions={canEdit && !isStudentView ? <><Button variant="secondary" icon={<Edit3 size={16} />} onClick={() => { setEditingTitle(true); setTitleDraft(detail.title) }}>编辑标题</Button>{isAdmin && <Button variant="secondary" icon={<Share2 size={16} />} onClick={() => setShowSharePanel(true)}>权限</Button>}{isAdmin && <Button icon={<Send size={16} />} onClick={() => setShowPublishModal(true)}>发布为作业</Button>}</> : undefined}
        />
        {editingTitle && (
          <Toolbar>
            <ToolbarGroup className={unifiedStyles.u1}><label htmlFor="problem-list-title">题单标题</label><Input id="problem-list-title" type="text" value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => event.key === 'Enter' && handleSaveTitle()} autoFocus className={unifiedStyles.u2} /></ToolbarGroup>
            <ToolbarGroup><Button variant="secondary" onClick={() => setEditingTitle(false)}>取消</Button><Button onClick={handleSaveTitle}>保存</Button></ToolbarGroup>
          </Toolbar>
        )}

          {/* 章节列表 */}
          {detail.Sections.map((section) => {
            const sectionNewRows = newRows.filter(r => r.sectionId === section.id)
            return (
              <div key={section.id} className={unifiedStyles.u3}>
                {/* 章节标题 */}
                <div className={unifiedStyles.u4}>
                  {editingSection === section.id ? (
                    <div className={unifiedStyles.u5}>
                      <Input type="text" value={sectionTitleDraft} onChange={e => setSectionTitleDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRenameSection(section.id)} autoFocus
                        className={unifiedStyles.u6}
                      />
                      <Button variant="ghost" onClick={() => handleRenameSection(section.id)} className={unifiedStyles.u7}>保存</Button>
                      <Button variant="ghost" onClick={() => setEditingSection(null)} className={unifiedStyles.u8}>取消</Button>
                    </div>
                  ) : (
                    <>
                      <h2 onClick={() => { if (canEdit && !isStudentView) { setEditingSection(section.id); setSectionTitleDraft(section.title) } }}
                        style={{ fontSize: '1rem', fontWeight: 600, cursor: canEdit && !isStudentView ? 'pointer' : 'default', margin: 0 }}>
                        {section.title}
                      </h2>
                      <span className={unifiedStyles.u9}>({section.Entries.length} 题)</span>
                    </>
                  )}
                  {canEdit && !isStudentView && editingSection !== section.id && (
                    <div className={unifiedStyles.u10}>
                      {detail.Sections.length > 1 && (
                        <Button variant="ghost" onClick={() => setDeleteSectionConfirm(section.id)} className={unifiedStyles.u11} title="删除章节">✕</Button>
                      )}
                    </div>
                  )}
                </div>

                {/* 题目表格 */}
                {(section.Entries.length > 0 || sectionNewRows.length > 0) ? (
                  <div className={unifiedStyles.u12}>
                    <table className={unifiedStyles.u13}>
                      <colgroup>
                        <col className={unifiedStyles.u14} />
                        {!isStudentView && <col className={unifiedStyles.u15} />}
                        {!isStudentView && <col className={unifiedStyles.u16} />}
                        <col />
                        {!isStudentView && <col className={unifiedStyles.u17} />}
                        {canEdit && !isStudentView && <col className={unifiedStyles.u18} />}
                      </colgroup>
                      <thead>
                        <tr className={unifiedStyles.u19}>
                          <th className={unifiedStyles.u20}>#</th>
                          {!isStudentView && <th className={unifiedStyles.u21}>OJ</th>}
                          {!isStudentView && <th className={unifiedStyles.u21}>题号</th>}
                          <th className={unifiedStyles.u21}>标题</th>
                          {!isStudentView && <th className={unifiedStyles.u21}>备注</th>}
                          {canEdit && !isStudentView && <th className={unifiedStyles.u20}>操作</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {section.Entries.map((entry, idx) => (
                          <tr key={entry.id} className={unifiedStyles.u22}>
                            <td className={unifiedStyles.u23}>{idx + 1}</td>
                            {!isStudentView && <td className={unifiedStyles.u24}>{getOjPlatformLabel(entry.Problem.ojBindings, entry.ojName)}</td>}
                            {!isStudentView && <td className={unifiedStyles.u25}>
                              <Link href={`${pathPrefix}/problems/${entry.problemId}`} className={unifiedStyles.u26}>
                                {entry.Problem.problemId}
                              </Link>
                            </td>}
                            <td className={unifiedStyles.u27}>
                              <span className={unifiedStyles.u28}>✓</span>
                              {!isStudentView ? (
                                <Link href={`${pathPrefix}/problems/${entry.problemId}`} className={unifiedStyles.u29} title={entry.Problem.title}>
                                  {entry.Problem.title}
                                </Link>
                              ) : (
                                <Button variant="ghost"
                                  type="button"
                                  onClick={() => openContextProblem(entry.id)}
                                  className={unifiedStyles.u30}
                                  title={`查看「${entry.Problem.title}」题面`}
                                >
                                  {entry.Problem.title}
                                </Button>
                              )}
                            </td>
                            {!isStudentView && <td className={unifiedStyles.u31}>
                              {editingEntry === entry.id ? (
                                <div className={unifiedStyles.u32}
                                  onBlur={(e) => {
                                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                      handleUpdateEntry(entry.id, { notes: editNotes || null })
                                    }
                                  }}
                                >
                                  <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
                                    autoFocus rows={2} wrap="soft"
                                    className={unifiedStyles.u33}
                                  />
                                  <Button variant="ghost" onClick={() => handleUpdateEntry(entry.id, { notes: editNotes || null })}
                                    className={unifiedStyles.u34}>
                                    ✓
                                  </Button>
                                </div>
                              ) : (
                                <Button variant="ghost" type="button" onClick={() => { if (!canEdit) return; setEditingEntry(entry.id); setEditNotes(entry.notes || '') }} disabled={!canEdit}
                                  style={{ cursor: canEdit ? 'pointer' : 'default', color: entry.notes ? 'var(--gray-600)' : 'var(--gray-400)', fontSize: '0.8rem', textAlign: 'left', width: '100%' }}>
                                  {entry.notes || (canEdit ? '点击添加' : '-')}
                                </Button>
                              )}
                            </td>}
                            {canEdit && !isStudentView && (
                              <td className={unifiedStyles.u35}>
                                <div className={unifiedStyles.u36}>
                                  <Button variant="ghost" onClick={() => handleMoveEntry(section.id, entry.id, 'up')} disabled={idx === 0}
                                    style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: 'var(--gray-400)', fontSize: '0.8rem', padding: '0.1rem 0.2rem', opacity: idx === 0 ? 0.3 : 1 }}>↑</Button>
                                  <Button variant="ghost" onClick={() => handleMoveEntry(section.id, entry.id, 'down')} disabled={idx === section.Entries.length - 1}
                                    style={{ background: 'none', border: 'none', cursor: idx === section.Entries.length - 1 ? 'not-allowed' : 'pointer', color: 'var(--gray-400)', fontSize: '0.8rem', padding: '0.1rem 0.2rem', opacity: idx === section.Entries.length - 1 ? 0.3 : 1 }}>↓</Button>
                                  <Button variant="ghost" onClick={() => setDeleteEntryConfirm(entry.id)}
                                    className={unifiedStyles.u37}>✕</Button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}

                        {/* 新行 */}
                        {canEdit && !isStudentView && sectionNewRows.map((row) => (
                          <tr key={row.id} className={unifiedStyles.u38}>
                            <td className={unifiedStyles.u23}>{section.Entries.length + sectionNewRows.indexOf(row) + 1}</td>
                            <td className={unifiedStyles.u25}>
                              <Select aria-label="选择" value={row.ojName} onChange={e => updateNewRow(row.id, { ojName: e.target.value, resolved: null })}
                                className={unifiedStyles.u39}>
                                {OJ_PLATFORMS_NO_ALL.map(oj => <option key={oj.value} value={oj.value}>{oj.label}</option>)}
                              </Select>
                            </td>
                            <td className={unifiedStyles.u25}>
                              <Input type="text" value={row.problemCode}
                                onChange={e => { updateNewRow(row.id, { problemCode: e.target.value, resolved: null }); handleResolveRow({ ...row, problemCode: e.target.value }) }}
                                placeholder="输入题号" autoFocus
                                className={unifiedStyles.u40}
                              />
                            </td>
                            <td className={unifiedStyles.u27}>
                              {row.saving ? <span className={unifiedStyles.u41}>保存中...</span>
                                : row.resolving ? <span className={unifiedStyles.u42}>检索中...</span>
                                : row.resolved ? row.resolved.found ? <span><span className={unifiedStyles.u28}>✓</span><span className={unifiedStyles.u29}>{row.resolved.title}</span></span>
                                  : <span className={unifiedStyles.u43}><AlertTriangle aria-hidden="true" size={14} />题目不存在</span>
                                : <span className={unifiedStyles.u42}>-</span>}
                            </td>
                            <td className={unifiedStyles.u25}>
                              <Textarea value={row.notes} onChange={e => updateNewRow(row.id, { notes: e.target.value })}
                                placeholder="备注" disabled={row.saving} rows={2} wrap="soft"
                                className={unifiedStyles.u44} />
                            </td>
                            <td className={unifiedStyles.u35}>
                              <div className={unifiedStyles.u36}>
                                {row.saving ? <span className={unifiedStyles.u45}>保存中...</span>
                                  : row.resolved?.found ? <span className={unifiedStyles.u46}>✓ 已就绪</span>
                                  : row.resolved && !row.resolved.found ? <span className={unifiedStyles.u47}>不存在</span>
                                  : null}
                                {!row.saving && <Button variant="ghost" onClick={() => removeNewRow(row.id)} className={unifiedStyles.u37}>✕</Button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className={unifiedStyles.u48}>暂无题目</div>
                )}

                {/* 添加题目 + 保存按钮 */}
                {canEdit && !isStudentView && (
                  <div className={unifiedStyles.u49}>
                    <Button variant="ghost" onClick={() => addNewRow(section.id)}
                      className={unifiedStyles.u50}>
                      + 添加一道题目
                    </Button>
                    {sectionNewRows.length > 0 && (
                      <Button variant="ghost"
                        onClick={() => saveAllSectionRows(section.id)}
                        disabled={!sectionNewRows.some(r => r.resolved?.found && !r.saving)}
                        style={{
                          padding: '0.5rem 1.5rem',
                          background: sectionNewRows.some(r => r.resolved?.found && !r.saving) ? 'var(--primary)' : 'var(--gray-300)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: sectionNewRows.some(r => r.resolved?.found && !r.saving) ? 'pointer' : 'not-allowed',
                          fontSize: '0.85rem',
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        保存 ({sectionNewRows.filter(r => r.resolved?.found && !r.saving).length} 题)
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* 添加章节 */}
          {canEdit && (
            <div className={unifiedStyles.u51}>
              {showNewSection ? (
                <div className={unifiedStyles.u52}>
                  <Input type="text" value={newSectionTitle} onChange={e => setNewSectionTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddSection()} placeholder="章节标题" autoFocus
                    className={unifiedStyles.u53} />
                  <Button variant="ghost" onClick={handleAddSection} className={unifiedStyles.u54}>确认</Button>
                  <Button variant="ghost" onClick={() => { setShowNewSection(false); setNewSectionTitle('') }} className={unifiedStyles.u55}>取消</Button>
                </div>
              ) : (
                <Button variant="ghost" onClick={() => setShowNewSection(true)}
                  className={unifiedStyles.u56}>
                  + 添加章节
                </Button>
              )}
            </div>
          )}

          <div className={unifiedStyles.u57}>
            共 {detail.Sections.length} 个章节，{totalEntries} 题
          </div>
      </PageFrame>

      {showPublishModal && detail && (
        <PublishHomeworkModal
          listId={listId}
          onClose={() => setShowPublishModal(false)}
          onPublished={() => { setShowPublishModal(false); toast.success('作业发布成功') }}
        />
      )}

      {showSharePanel && detail && (
        <SharePanelModal listId={listId} shares={detail.Shares} onClose={() => setShowSharePanel(false)} onUpdate={fetchDetail} />
      )}

      <DetailDialog
        isOpen={!!contextEntryId}
        onClose={closeContextProblem}
        title={contextProblem?.title || '题目详情'}
        size="xl"
      >
        {contextLoading ? (
          <SkeletonRegion rows={7} label="题面正在准备" />
        ) : contextError ? (
          <Empty
            title="无法显示题面"
            description={contextError}
            action={<Button onClick={() => contextEntryId && openContextProblem(contextEntryId)}>重试</Button>}
          />
        ) : contextProblem ? (
          <div className={unifiedStyles.u58}>
            <div className={unifiedStyles.u59}>
              {contextProblem.difficulty && <span>难度：{contextProblem.difficulty}</span>}
              {contextProblem.timeLimit && <span>时间限制：{contextProblem.timeLimit} ms</span>}
              {contextProblem.memoryLimit && <span>内存限制：{contextProblem.memoryLimit} MB</span>}
            </div>
            {contextProblem.statements.find(item => item.content)?.content || contextProblem.description ? (
              <MarkdownRenderer content={contextProblem.statements.find(item => item.content)?.content || contextProblem.description || ''} />
            ) : contextProblem.statementPdfUrl ? (
              <a href={getAssetUrl(contextProblem.statementPdfUrl)} target="_blank" rel="noreferrer">打开 PDF 题面</a>
            ) : (
              <Empty title="题面暂无文本内容" description="请联系教师补充题面。" />
            )}
            {contextProblem.attachments.length > 0 && (
              <section>
                <h3 className={unifiedStyles.u60}>附件</h3>
                <div className={unifiedStyles.u61}>
                  {contextProblem.attachments.map(attachment => (
                    <a key={attachment.id} href={getAssetUrl(attachment.fileUrl)} target="_blank" rel="noreferrer">
                      {attachment.fileName}
                    </a>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : null}
      </DetailDialog>

      <ConfirmModal isOpen={!!deleteEntryConfirm} onClose={() => setDeleteEntryConfirm(null)}
        onConfirm={() => { if (deleteEntryConfirm) handleDeleteEntry(deleteEntryConfirm) }}
        title="确认删除" message="确认删除此题目？" confirmText="删除" danger />

      <ConfirmModal isOpen={!!deleteSectionConfirm} onClose={() => setDeleteSectionConfirm(null)}
        onConfirm={() => { if (deleteSectionConfirm) handleDeleteSection(deleteSectionConfirm) }}
        title="确认删除章节" message="删除章节将同时删除其下所有题目，确认继续？" confirmText="删除" danger />
    </>
  )
}

// ==================== 发布为作业弹窗 ====================

function PublishHomeworkModal({ listId, onClose, onPublished }: {
  listId: string
  onClose: () => void
  onPublished: () => void
}) {
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [title, setTitle] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [format, setFormat] = useState('oi')
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()

  useEffect(() => {
    apiClient.get('/api/teams?view=mine&pageSize=100').then(res => {
      if (res.success) {
        const list = (res.data as any)?.items || res.data || []
        setTeams(list)
        if (list.length > 0) setSelectedTeamId(list[0].id)
      }
    })
  }, [])

  const handleSubmit = async () => {
    if (!selectedTeamId || !startTime || !endTime) {
      toast.warning('请填写完整信息')
      return
    }
    setSubmitting(true)
    try {
      const res = await apiClient.post(`/api/problem-lists/${listId}/publish-homework`, {
        teamId: selectedTeamId,
        title: title.trim() || undefined,
        startTime,
        endTime,
        format,
      })
      if (res.success) {
        onPublished()
      } else {
        toast.error(res.message || '发布失败')
      }
    } catch (e: any) {
      toast.error(e?.message || '发布失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <FormDialog isOpen={true} onClose={onClose} title="发布为作业" size="md">
      <div className={unifiedStyles.u62}>
        <div>
          <label className={unifiedStyles.u63}>目标团队</label>
          <Select aria-label="选择" value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}
            className={unifiedStyles.u64}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </div>
        <div>
          <label className={unifiedStyles.u63}>作业标题（留空则使用题单标题）</label>
          <Input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="可选"
            className={unifiedStyles.u65} />
        </div>
        <div>
          <label className={unifiedStyles.u63}>赛制</label>
          <Select aria-label="选择" value={format} onChange={e => setFormat(e.target.value)}
            className={unifiedStyles.u64}>
            <option value="oi">OI</option>
            <option value="ioi">IOI</option>
            <option value="icpc">ICPC</option>
          </Select>
        </div>
        <div className={unifiedStyles.u66}>
          <div>
            <label className={unifiedStyles.u63}>开始时间</label>
            <Input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)}
              className={unifiedStyles.u65} />
          </div>
          <div>
            <label className={unifiedStyles.u63}>结束时间</label>
            <Input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)}
              className={unifiedStyles.u65} />
          </div>
        </div>
        <div className={unifiedStyles.u67}>
          <Button variant="ghost" onClick={onClose} className={unifiedStyles.u68}>取消</Button>
          <Button variant="ghost" onClick={handleSubmit} disabled={submitting}
            style={{ padding: '0.5rem 1rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 'var(--radius)', cursor: submitting ? 'not-allowed' : 'pointer', fontSize: '0.9rem', fontWeight: 500 }}>
            {submitting ? '发布中...' : '发布'}
          </Button>
        </div>
      </div>
    </FormDialog>
  )
}

// ==================== 权限管理弹窗 ====================

interface Candidate {
  id: string
  name: string
  type: 'teacher' | 'student'
  username: string
  avatar: string | null
}

function SharePanelModal({ listId, shares, onClose, onUpdate }: {
  listId: string
  shares: ShareInfo[]
  onClose: () => void
  onUpdate: () => void
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null)
  const [permission, setPermission] = useState<'view' | 'edit'>('view')
  const [submitting, setSubmitting] = useState(false)
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 搜索候选人
  const fetchCandidates = useCallback((kw: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!kw.trim()) { setCandidates([]); return }
    setSearching(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const [tRes, sRes] = await Promise.all([
          apiClient.get<Candidate[]>(`/api/problem-lists/${listId}/share-candidates?type=teacher&keyword=${encodeURIComponent(kw)}`),
          apiClient.get<Candidate[]>(`/api/problem-lists/${listId}/share-candidates?type=student&keyword=${encodeURIComponent(kw)}`),
        ])
        const teachers = (tRes.success && tRes.data) ? tRes.data : []
        const students = (sRes.success && sRes.data) ? sRes.data : []
        // 排除已分享的
        const sharedIds = new Set(shares.map(s => s.targetId))
        setCandidates([...teachers, ...students].filter(c => !sharedIds.has(c.id)))
      } catch { /* skip */ } finally {
        setSearching(false)
      }
    }, 300)
  }, [listId, shares])

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleKeywordChange = (kw: string) => {
    setKeyword(kw)
    setSelectedCandidate(null)
    if (kw.trim()) {
      setShowDropdown(true)
      fetchCandidates(kw)
    } else {
      setShowDropdown(false)
      setCandidates([])
    }
  }

  const handleSelectCandidate = (c: Candidate) => {
    setSelectedCandidate(c)
    setKeyword(c.name)
    setShowDropdown(false)
  }

  const handleSubmit = async () => {
    if (!selectedCandidate) return
    setSubmitting(true)
    try {
      await apiClient.post(`/api/problem-lists/${listId}/shares`, {
        targetType: selectedCandidate.type,
        targetId: selectedCandidate.id,
        permission,
      })
      setSelectedCandidate(null)
      setKeyword('')
      setCandidates([])
      onUpdate()
    } catch { /* skip */ } finally {
      setSubmitting(false)
    }
  }

  const handleTogglePermission = async (shareId: string, currentPerm: string) => {
    const newPerm = currentPerm === 'view' ? 'edit' : 'view'
    try {
      // 找到对应的 share 信息
      const share = shares.find(s => s.id === shareId)
      if (!share) return
      await apiClient.post(`/api/problem-lists/${listId}/shares`, {
        targetType: share.targetType,
        targetId: share.targetId,
        permission: newPerm,
      })
      onUpdate()
    } catch { /* skip */ }
  }

  const handleRemove = async (shareId: string) => {
    await apiClient.delete(`/api/problem-lists/${listId}/shares/${shareId}`)
    onUpdate()
  }

  return (
    <FormDialog isOpen={true} onClose={onClose} title="权限管理" size="xl">
      <div className={unifiedStyles.u69}>
        {/* 表头行 */}
        <div className={unifiedStyles.u70}>
          <span className={unifiedStyles.u1}>用户</span>
          <span className={unifiedStyles.u71}>权限</span>
          <span className={unifiedStyles.u72} />
        </div>

        {/* 操作行：搜索 + 权限下拉 + 提交 */}
        <div className={unifiedStyles.u73} ref={dropdownRef}>
          {/* 搜索框 */}
          <div className={unifiedStyles.u74}>
            <Input
              type="text" value={keyword} onChange={e => handleKeywordChange(e.target.value)}
              onFocus={() => { if (keyword.trim() && candidates.length > 0) setShowDropdown(true) }}
              placeholder="搜索用户"
              style={{
                width: '100%', padding: '0.55rem 1rem',
                border: `1px solid ${selectedCandidate ? 'var(--success)' : 'var(--border)'}`,
                borderRadius: '6px', fontSize: '0.95rem', boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            {/* 候选人下拉浮层 */}
            {showDropdown && (candidates.length > 0 || searching) && (
              <div className={unifiedStyles.u75}>
                {searching ? (
                  <div className={unifiedStyles.u76}>搜索中...</div>
                ) : candidates.map(c => (
                  <Button variant="ghost"
                    type="button"
                    key={c.id}
                    onClick={() => handleSelectCandidate(c)}
                    className={`${styles.candidate} ${selectedCandidate?.id === c.id ? styles.candidateSelected : ''}`}
                  >
                    {/* 头像 */}
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                      background: c.avatar ? `url(${getAssetUrl(c.avatar)}) center/cover` : 'var(--primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: 'white', fontWeight: 600, fontSize: '0.8rem',
                    }}>
                      {!c.avatar && (c.name || '?').charAt(0)}
                    </div>
                    <div className={unifiedStyles.u77}>
                      <span className={unifiedStyles.u78}>{c.name}</span>
                      <span className={unifiedStyles.u79}>({c.username})</span>
                    </div>
                    <span style={{
                      fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px',
                      background: c.type === 'teacher' ? 'var(--info-light)' : 'var(--success-light)',
                      color: c.type === 'teacher' ? 'var(--primary-hover)' : 'var(--success)',
                    }}>
                      {c.type === 'teacher' ? '教师' : '学生'}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* 权限下拉 */}
          <Select aria-label="选择" value={permission} onChange={e => setPermission(e.target.value as 'view' | 'edit')}
            className={unifiedStyles.u80}>
            <option value="view">只读</option>
            <option value="edit">可读写</option>
          </Select>

          {/* 提交按钮 */}
          <Button variant="ghost"
            onClick={handleSubmit}
            disabled={!selectedCandidate || submitting}
            style={{
              width: '72px', padding: '0.55rem 0', border: '1px solid var(--border)', borderRadius: '6px',
              background: selectedCandidate ? 'var(--primary)' : 'white',
              color: selectedCandidate ? 'white' : 'var(--gray-400)',
              cursor: selectedCandidate ? 'pointer' : 'not-allowed',
              fontSize: '0.95rem', fontWeight: 500,
            }}
          >
            {submitting ? '...' : '提交'}
          </Button>
        </div>

        {/* 已分享列表 — 可滚动 */}
        <div className={unifiedStyles.u81}>
          {shares.length > 0 ? shares.map(share => (
            <div key={share.id} className={unifiedStyles.u82}>
              {/* 头像 */}
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                background: share.targetAvatar ? `url(${getAssetUrl(share.targetAvatar)}) center/cover` : 'var(--primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 600, fontSize: '0.8rem',
              }}>
                {!share.targetAvatar && (share.targetName || '?').charAt(0)}
              </div>
              <div className={unifiedStyles.u77}>
                <span className={unifiedStyles.u78}>{share.targetName}</span>
                {share.targetUsername && (
                  <span className={unifiedStyles.u79}>({share.targetUsername})</span>
                )}
              </div>
              <span className={unifiedStyles.u83}>
                {share.permission === 'edit' ? '可读写' : '只读'}
              </span>
              {/* 编辑图标 — 切换权限 */}
              <Button variant="ghost" onClick={() => handleTogglePermission(share.id, share.permission)} title="切换权限"
                className={unifiedStyles.u84}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                </svg>
              </Button>
              {/* 删除图标 */}
              <Button variant="ghost" onClick={() => handleRemove(share.id)} title="移除"
                className={unifiedStyles.u84}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </Button>
            </div>
          )) : (
            <div className={unifiedStyles.u85}>
              暂无分享
            </div>
          )}
        </div>
      </div>
    </FormDialog>
  )
}
