'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { Modal } from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { OJ_PLATFORMS_NO_ALL } from '@/lib/oj-platforms'
import { getAssetUrl } from '@/lib/assets'

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

export default function ProblemListDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { user } = useAuth()
  const listId = params.id as string
  const pathPrefix = user?.role === 'student' ? '/student' : '/teacher'

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

  const canEdit = detail?._permission === 'admin' || detail?._permission === 'edit'
  const isAdmin = detail?._permission === 'admin'

  useEffect(() => { fetchDetail() }, [listId])

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiClient.get<ListDetail>(`/api/problem-lists/${listId}`)
      if (res.success && res.data) {
        const data = res.data as any
        setDetail({
          ...data,
          Sections: data.Sections || data.sections || [],
          Shares: data.Shares || data.shares || [],
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

  // ==================== 渲染 ====================

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center' }}>加载中...</div>
  if (!detail) return <div style={{ padding: '3rem', textAlign: 'center' }}>题单不存在或无权限访问</div>

  return (
    <>
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
          {/* 顶部 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <button
                onClick={() => router.push(`${pathPrefix}/problem-lists`)}
                style={{ padding: '0.375rem 0.75rem', background: 'transparent', color: 'var(--gray-500)', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                ← 返回
              </button>
              {editingTitle ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="text" value={titleDraft} onChange={e => setTitleDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveTitle()} autoFocus
                    style={{ fontSize: '1.25rem', fontWeight: 600, padding: '0.25rem 0.5rem', border: '1px solid var(--primary)', borderRadius: '4px', width: '300px' }}
                  />
                  <button onClick={handleSaveTitle} style={{ padding: '0.25rem 0.5rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>保存</button>
                  <button onClick={() => setEditingTitle(false)} style={{ padding: '0.25rem 0.5rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>取消</button>
                </div>
              ) : (
                <h1
                  onClick={() => { if (canEdit) { setEditingTitle(true); setTitleDraft(detail.title) } }}
                  style={{ fontSize: '1.25rem', fontWeight: 600, cursor: canEdit ? 'pointer' : 'default' }}
                >
                  {detail.title}
                </h1>
              )}
            </div>
            {isAdmin && (
              <button onClick={() => setShowSharePanel(true)} style={{ padding: '0.375rem 0.75rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                权限管理
              </button>
            )}
          </div>

          {detail.description && (
            <p style={{ color: 'var(--gray-500)', fontSize: '0.85rem', marginBottom: '1rem' }}>{detail.description}</p>
          )}

          {/* 章节列表 */}
          {detail.Sections.map((section) => {
            const sectionNewRows = newRows.filter(r => r.sectionId === section.id)
            return (
              <div key={section.id} style={{ marginBottom: '1.5rem' }}>
                {/* 章节标题 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.625rem 0', borderBottom: '2px solid var(--gray-200)', marginBottom: '0.5rem' }}>
                  {editingSection === section.id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                      <input type="text" value={sectionTitleDraft} onChange={e => setSectionTitleDraft(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRenameSection(section.id)} autoFocus
                        style={{ fontSize: '1rem', fontWeight: 600, padding: '0.2rem 0.5rem', border: '1px solid var(--primary)', borderRadius: '4px', width: '250px' }}
                      />
                      <button onClick={() => handleRenameSection(section.id)} style={{ padding: '0.2rem 0.5rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>保存</button>
                      <button onClick={() => setEditingSection(null)} style={{ padding: '0.2rem 0.5rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>取消</button>
                    </div>
                  ) : (
                    <>
                      <h2 onClick={() => { if (canEdit) { setEditingSection(section.id); setSectionTitleDraft(section.title) } }}
                        style={{ fontSize: '1rem', fontWeight: 600, cursor: canEdit ? 'pointer' : 'default', margin: 0 }}>
                        {section.title}
                      </h2>
                      <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>({section.Entries.length} 题)</span>
                    </>
                  )}
                  {canEdit && editingSection !== section.id && (
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.25rem' }}>
                      {detail.Sections.length > 1 && (
                        <button onClick={() => setDeleteSectionConfirm(section.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', fontSize: '0.75rem', padding: '0.1rem 0.3rem' }} title="删除章节">✕</button>
                      )}
                    </div>
                  )}
                </div>

                {/* 题目表格 */}
                {(section.Entries.length > 0 || sectionNewRows.length > 0) ? (
                  <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '36px' }} />
                        <col style={{ width: '150px' }} />
                        <col style={{ width: '80px' }} />
                        <col />{/* 标题 - 自适应 */}
                        <col style={{ width: '600px' }} />{/* 备注 */}
                        {canEdit && <col style={{ width: '60px' }} />}
                      </colgroup>
                      <thead>
                        <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 500, color: 'var(--gray-500)', fontSize: '0.75rem' }}>#</th>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 500, color: 'var(--gray-500)', fontSize: '0.75rem' }}>OJ</th>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 500, color: 'var(--gray-500)', fontSize: '0.75rem' }}>题号</th>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 500, color: 'var(--gray-500)', fontSize: '0.75rem' }}>标题</th>
                          <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 500, color: 'var(--gray-500)', fontSize: '0.75rem' }}>备注</th>
                          {canEdit && <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 500, color: 'var(--gray-500)', fontSize: '0.75rem' }}>操作</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {section.Entries.map((entry, idx) => (
                          <tr key={entry.id} style={{ borderBottom: '1px solid var(--gray-100)' }}>
                            <td style={{ padding: '0.4rem 0.75rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '0.8rem' }}>{idx + 1}</td>
                            <td style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getOjPlatformLabel(entry.Problem.ojBindings, entry.ojName)}</td>
                            <td style={{ padding: '0.4rem 0.75rem' }}>
                              <span onClick={() => router.push(`${pathPrefix}/problems/${entry.problemId}`)} style={{ color: 'var(--primary)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                {entry.Problem.problemId}
                              </span>
                            </td>
                            <td style={{ padding: '0.4rem 0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <span style={{ color: 'var(--success)', fontSize: '0.75rem', marginRight: '0.25rem' }}>✓</span>
                              <span onClick={() => router.push(`${pathPrefix}/problems/${entry.problemId}`)} style={{ color: 'var(--primary)', cursor: 'pointer', fontSize: '0.85rem' }} title={entry.Problem.title}>
                                {entry.Problem.title}
                              </span>
                            </td>
                            <td style={{ padding: '0.4rem 0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {editingEntry === entry.id ? (
                                <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}
                                  onBlur={(e) => {
                                    // 仅在焦点离开整个容器时保存
                                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                      handleUpdateEntry(entry.id, { notes: editNotes || null })
                                    }
                                  }}
                                >
                                  <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
                                    autoFocus rows={2} wrap="soft"
                                    style={{ flex: 1, padding: '0.15rem 0.3rem', border: '1px solid var(--primary)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', minWidth: 0, resize: 'vertical', lineHeight: '1.4', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-all', boxSizing: 'border-box' }}
                                  />
                                  <button onClick={() => handleUpdateEntry(entry.id, { notes: editNotes || null })}
                                    style={{ padding: '0.1rem 0.3rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.7rem', flexShrink: 0 }}>
                                    ✓
                                  </button>
                                </div>
                              ) : (
                                <span onClick={() => { if (!canEdit) return; setEditingEntry(entry.id); setEditNotes(entry.notes || '') }}
                                  style={{ cursor: canEdit ? 'pointer' : 'default', color: entry.notes ? 'var(--gray-600)' : 'var(--gray-400)', fontSize: '0.8rem' }}>
                                  {entry.notes || (canEdit ? '点击添加' : '-')}
                                </span>
                              )}
                            </td>
                            {canEdit && (
                              <td style={{ padding: '0.4rem 0.75rem', textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center', alignItems: 'center' }}>
                                  <button onClick={() => handleMoveEntry(section.id, entry.id, 'up')} disabled={idx === 0}
                                    style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer', color: 'var(--gray-400)', fontSize: '0.8rem', padding: '0.1rem 0.2rem', opacity: idx === 0 ? 0.3 : 1 }}>↑</button>
                                  <button onClick={() => handleMoveEntry(section.id, entry.id, 'down')} disabled={idx === section.Entries.length - 1}
                                    style={{ background: 'none', border: 'none', cursor: idx === section.Entries.length - 1 ? 'not-allowed' : 'pointer', color: 'var(--gray-400)', fontSize: '0.8rem', padding: '0.1rem 0.2rem', opacity: idx === section.Entries.length - 1 ? 0.3 : 1 }}>↓</button>
                                  <button onClick={() => setDeleteEntryConfirm(entry.id)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', fontSize: '0.8rem', padding: '0.1rem 0.2rem' }}>✕</button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}

                        {/* 新行 */}
                        {canEdit && sectionNewRows.map((row) => (
                          <tr key={row.id} style={{ borderBottom: '1px solid var(--gray-100)', background: '#fffbe6' }}>
                            <td style={{ padding: '0.4rem 0.75rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '0.8rem' }}>{section.Entries.length + sectionNewRows.indexOf(row) + 1}</td>
                            <td style={{ padding: '0.4rem 0.75rem' }}>
                              <select value={row.ojName} onChange={e => updateNewRow(row.id, { ojName: e.target.value, resolved: null })}
                                style={{ padding: '0.25rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', width: '100%' }}>
                                {OJ_PLATFORMS_NO_ALL.map(oj => <option key={oj.value} value={oj.value}>{oj.label}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: '0.4rem 0.75rem' }}>
                              <input type="text" value={row.problemCode}
                                onChange={e => { updateNewRow(row.id, { problemCode: e.target.value, resolved: null }); handleResolveRow({ ...row, problemCode: e.target.value }) }}
                                placeholder="输入题号" autoFocus
                                style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'monospace', width: '100%' }}
                              />
                            </td>
                            <td style={{ padding: '0.4rem 0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {row.saving ? <span style={{ color: 'var(--primary)', fontSize: '0.8rem' }}>保存中...</span>
                                : row.resolving ? <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem' }}>检索中...</span>
                                : row.resolved ? row.resolved.found ? <span><span style={{ color: 'var(--success)', fontSize: '0.75rem', marginRight: '0.25rem' }}>✓</span><span style={{ color: 'var(--primary)', fontSize: '0.85rem' }}>{row.resolved.title}</span></span>
                                  : <span><span style={{ color: 'var(--error)', fontSize: '0.75rem', marginRight: '0.25rem' }}>⚠️</span><span style={{ color: 'var(--error)', fontSize: '0.85rem' }}>题目不存在</span></span>
                                : <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem' }}>-</span>}
                            </td>
                            <td style={{ padding: '0.4rem 0.75rem' }}>
                              <textarea value={row.notes} onChange={e => updateNewRow(row.id, { notes: e.target.value })}
                                placeholder="备注" disabled={row.saving} rows={2} wrap="soft"
                                style={{ width: '100%', padding: '0.15rem 0.3rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', minWidth: 0, resize: 'vertical', lineHeight: '1.4', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-all', boxSizing: 'border-box' }} />
                            </td>
                            <td style={{ padding: '0.4rem 0.75rem', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center', alignItems: 'center' }}>
                                {row.saving ? <span style={{ color: 'var(--primary)', fontSize: '0.75rem' }}>保存中...</span>
                                  : row.resolved?.found ? <span style={{ color: 'var(--success)', fontSize: '0.75rem' }}>✓ 已就绪</span>
                                  : row.resolved && !row.resolved.found ? <span style={{ color: 'var(--error)', fontSize: '0.75rem' }}>不存在</span>
                                  : null}
                                {!row.saving && <button onClick={() => removeNewRow(row.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', fontSize: '0.8rem', padding: '0.1rem 0.2rem' }}>✕</button>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--gray-400)', fontSize: '0.85rem', background: 'white', borderRadius: '8px', border: '1px solid var(--border)' }}>暂无题目</div>
                )}

                {/* 添加题目 + 保存按钮 */}
                {canEdit && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => addNewRow(section.id)}
                      style={{ flex: 1, padding: '0.5rem', background: 'transparent', border: '1px dashed var(--border)', borderRadius: '6px', cursor: 'pointer', color: 'var(--gray-400)', fontSize: '0.85rem' }}>
                      + 添加一道题目
                    </button>
                    {sectionNewRows.length > 0 && (
                      <button
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
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* 添加章节 */}
          {canEdit && (
            <div style={{ marginTop: '1rem' }}>
              {showNewSection ? (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input type="text" value={newSectionTitle} onChange={e => setNewSectionTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddSection()} placeholder="章节标题" autoFocus
                    style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid var(--primary)', borderRadius: '6px', fontSize: '0.85rem' }} />
                  <button onClick={handleAddSection} style={{ padding: '0.5rem 1rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>确认</button>
                  <button onClick={() => { setShowNewSection(false); setNewSectionTitle('') }} style={{ padding: '0.5rem 1rem', background: 'transparent', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>取消</button>
                </div>
              ) : (
                <button onClick={() => setShowNewSection(true)}
                  style={{ width: '100%', padding: '0.75rem', background: 'transparent', border: '1px dashed var(--border)', borderRadius: '6px', cursor: 'pointer', color: 'var(--gray-400)', fontSize: '0.85rem' }}>
                  + 添加章节
                </button>
              )}
            </div>
          )}

          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--gray-400)' }}>
            共 {detail.Sections.length} 个章节，{totalEntries} 题
          </div>
        </div>
      </div>

      {showSharePanel && detail && (
        <SharePanelModal listId={listId} shares={detail.Shares} onClose={() => setShowSharePanel(false)} onUpdate={fetchDetail} />
      )}

      <ConfirmModal isOpen={!!deleteEntryConfirm} onClose={() => setDeleteEntryConfirm(null)}
        onConfirm={() => { if (deleteEntryConfirm) handleDeleteEntry(deleteEntryConfirm) }}
        title="确认删除" message="确认删除此题目？" confirmText="删除" danger />

      <ConfirmModal isOpen={!!deleteSectionConfirm} onClose={() => setDeleteSectionConfirm(null)}
        onConfirm={() => { if (deleteSectionConfirm) handleDeleteSection(deleteSectionConfirm) }}
        title="确认删除章节" message="删除章节将同时删除其下所有题目，确认继续？" confirmText="删除" danger />
    </>
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
    <Modal isOpen={true} onClose={onClose} title="权限管理" width="800px">
      <div style={{ minHeight: '420px', display: 'flex', flexDirection: 'column' }}>
        {/* 表头行 */}
        <div style={{ display: 'flex', fontSize: '0.8rem', color: 'var(--gray-400)', marginBottom: '0.75rem', padding: '0 0.25rem', flexShrink: 0 }}>
          <span style={{ flex: 1 }}>用户</span>
          <span style={{ width: '110px', textAlign: 'center' }}>权限</span>
          <span style={{ width: '72px' }} />
        </div>

        {/* 操作行：搜索 + 权限下拉 + 提交 */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.25rem', position: 'relative', flexShrink: 0 }} ref={dropdownRef}>
          {/* 搜索框 */}
          <div style={{ flex: 1, position: 'relative' }}>
            <input
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
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                background: 'white', border: '1px solid var(--border)', borderRadius: '8px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: '240px', overflowY: 'auto', marginTop: '4px',
              }}>
                {searching ? (
                  <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--gray-400)', fontSize: '0.9rem' }}>搜索中...</div>
                ) : candidates.map(c => (
                  <div
                    key={c.id}
                    onClick={() => handleSelectCandidate(c)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.6rem 1rem', cursor: 'pointer',
                      background: selectedCandidate?.id === c.id ? 'var(--info-light)' : 'transparent',
                      borderBottom: '1px solid var(--gray-100)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-muted)')}
                    onMouseLeave={e => (e.currentTarget.style.background = selectedCandidate?.id === c.id ? 'var(--info-light)' : 'transparent')}
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
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 500, fontSize: '0.95rem' }}>{c.name}</span>
                      <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem', marginLeft: '0.4rem' }}>({c.username})</span>
                    </div>
                    <span style={{
                      fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px',
                      background: c.type === 'teacher' ? 'var(--info-light)' : 'var(--success-light)',
                      color: c.type === 'teacher' ? 'var(--primary-hover)' : 'var(--success)',
                    }}>
                      {c.type === 'teacher' ? '教师' : '学生'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 权限下拉 */}
          <select value={permission} onChange={e => setPermission(e.target.value as 'view' | 'edit')}
            style={{ width: '110px', padding: '0.55rem 0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.95rem' }}>
            <option value="view">只读</option>
            <option value="edit">可读写</option>
          </select>

          {/* 提交按钮 */}
          <button
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
          </button>
        </div>

        {/* 已分享列表 — 可滚动 */}
        <div style={{ borderTop: '1px solid var(--gray-200)', paddingTop: '0.75rem', flex: 1, overflowY: 'auto', minHeight: '200px', maxHeight: '400px' }}>
          {shares.length > 0 ? shares.map(share => (
            <div key={share.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.65rem 0.25rem', borderBottom: '1px solid var(--gray-100)',
            }}>
              {/* 头像 */}
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                background: share.targetAvatar ? `url(${getAssetUrl(share.targetAvatar)}) center/cover` : 'var(--primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontWeight: 600, fontSize: '0.8rem',
              }}>
                {!share.targetAvatar && (share.targetName || '?').charAt(0)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 500, fontSize: '0.95rem' }}>{share.targetName}</span>
                {share.targetUsername && (
                  <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem', marginLeft: '0.4rem' }}>({share.targetUsername})</span>
                )}
              </div>
              <span style={{ fontSize: '0.95rem', color: 'var(--gray-600)' }}>
                {share.permission === 'edit' ? '可读写' : '只读'}
              </span>
              {/* 编辑图标 — 切换权限 */}
              <button onClick={() => handleTogglePermission(share.id, share.permission)} title="切换权限"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', padding: '0.2rem', display: 'flex', alignItems: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                </svg>
              </button>
              {/* 删除图标 */}
              <button onClick={() => handleRemove(share.id)} title="移除"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', padding: '0.2rem', display: 'flex', alignItems: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          )) : (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-400)', fontSize: '0.95rem' }}>
              暂无分享
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
