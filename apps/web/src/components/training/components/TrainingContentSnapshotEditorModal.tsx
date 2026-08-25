'use client'

import { useEffect, useState } from 'react'
import apiClient from '@/lib/apiClient'
import { FormDialog } from '@/components/ui/Dialogs'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { useToast } from '@/components/ui/Toast'

export interface EditableActivitySnapshot {
  kind: 'statement' | 'solution'
  trainingProblemId: string
  snapshotId: string
  label: string
  format: string
  content: string | null
  fileUrl: string | null
}

interface Props {
  isOpen: boolean
  trainingId: string
  snapshot: EditableActivitySnapshot | null
  onClose: () => void
  onSaved: (result: { snapshotId: string; revision: number }, kind: 'statement' | 'solution') => Promise<void> | void
}

export function TrainingContentSnapshotEditorModal({ isOpen, trainingId, snapshot, onClose, onSaved }: Props) {
  const toast = useToast()
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setContent(snapshot?.content || '')
    setFile(null)
  }, [snapshot])

  const save = async () => {
    if (!snapshot) return
    setSaving(true)
    const base = `/api/trainings/${trainingId}/problems/${snapshot.trainingProblemId}/content-snapshots/${snapshot.kind}/${snapshot.snapshotId}`
    if (snapshot.format === 'pdf' && !file) {
      toast.error('请选择新的 PDF 文件')
      setSaving(false)
      return
    }
    const response = snapshot.format === 'pdf'
      ? await (async () => {
        const body = new FormData()
        body.append('file', file!)
        return apiClient.postFile<{ snapshotId: string; revision: number }>(`${base}/pdf`, body, { timeout: 30000 })
      })()
      : await apiClient.put<{ snapshotId: string; revision: number }>(base, { content })
    if (response.success && response.data) {
      toast.success(`活动${snapshot.kind === 'statement' ? '题面' : '题解'}已更新至 revision ${response.data.revision}`)
      await onSaved(response.data, snapshot.kind)
      onClose()
    } else toast.error(response.message || '保存失败')
    setSaving(false)
  }

  const isPdf = snapshot?.format === 'pdf'
  return (
    <FormDialog
      isOpen={isOpen && !!snapshot}
      onClose={onClose}
      title={`编辑活动${snapshot?.kind === 'statement' ? '题面' : '题解'} · ${snapshot?.label || ''}`}
      size="xl"
      footer={<div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}><button onClick={onClose} disabled={saving}>取消</button><button onClick={save} disabled={saving || (!isPdf && !content.trim())}>{saving ? '保存中…' : '保存新 revision'}</button></div>}
    >
      <div style={{ marginBottom: '0.85rem', padding: '0.75rem', borderRadius: '8px', background: 'var(--info-light)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        本次编辑只影响当前活动，并创建新的不可变快照；题库原版本、用户版本和其他活动不会改变。
      </div>
      {isPdf ? (
        <div style={{ display: 'grid', gap: '0.85rem' }}>
          {snapshot?.fileUrl && <a href={snapshot.fileUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>查看当前 PDF</a>}
          <label style={{ padding: '1rem', border: '1px dashed var(--border)', borderRadius: '8px', background: 'var(--gray-50)' }}>
            替换 PDF（最大 20MB）
            <input type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] || null)} style={{ display: 'block', marginTop: '0.7rem' }} />
          </label>
        </div>
      ) : <MarkdownEditor value={content} onChange={setContent} minHeight="440px" showPreview />}
    </FormDialog>
  )
}
