'use client'

import { useEffect, useState } from 'react'
import unifiedStyles from './TrainingContentSnapshotEditorModal.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
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
      footer={<div className={unifiedStyles.u1}><Button variant="ghost" onClick={onClose} disabled={saving}>取消</Button><Button variant="ghost" onClick={save} disabled={saving || (!isPdf && !content.trim())}>{saving ? '保存中…' : '保存新 revision'}</Button></div>}
    >
      <div className={unifiedStyles.u2}>
        本次编辑只影响当前活动，并创建新的不可变快照；题库原版本、用户版本和其他活动不会改变。
      </div>
      {isPdf ? (
        <div className={unifiedStyles.u3}>
          {snapshot?.fileUrl && <a href={snapshot.fileUrl} target="_blank" rel="noreferrer" className={unifiedStyles.u4}>查看当前 PDF</a>}
          <label className={unifiedStyles.u5}>
            替换 PDF（最大 20MB）
            <Input type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] || null)} className={unifiedStyles.u6} />
          </label>
        </div>
      ) : <MarkdownEditor value={content} onChange={setContent} minHeight="440px" showPreview />}
    </FormDialog>
  )
}
