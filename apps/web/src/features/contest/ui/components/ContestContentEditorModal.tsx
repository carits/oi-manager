'use client'

import { useEffect, useState } from 'react'
import unifiedStyles from './ContestContentEditorModal.unified.module.css'
import { Input } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { updateContestContentMarkdown, uploadContestContentPdf } from '../../api/contestApi'
import { FormDialog } from '@/components/ui/Dialogs'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { useToast } from '@/components/ui/Toast'

export interface EditableContestContent {
  kind: 'statement' | 'solution'
  contestProblemId: string
  label: string
  format: string
  content: string | null
  fileUrl: string | null
}

interface Props {
  isOpen: boolean
  contestId: string
  value: EditableContestContent | null
  onClose: () => void
  onSaved: (kind: 'statement' | 'solution') => Promise<void> | void
}

export function ContestContentEditorModal({ isOpen, contestId, value, onClose, onSaved }: Props) {
  const toast = useToast()
  const [content, setContent] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setContent(value?.content || '')
    setFile(null)
  }, [value])

  const save = async () => {
    if (!value) return
    setSaving(true)
    try {
      if (value.format === 'pdf' && !file) {
        toast.error('请选择新的 PDF 文件')
        return
      }
      const response = value.format === 'pdf'
        ? await uploadContestContentPdf(contestId, value.contestProblemId, value.kind, file!)
        : await updateContestContentMarkdown(contestId, value.contestProblemId, value.kind, content)
      if ('ok' in response) {
        if (!response.ok) {
          toast.error(response.error.userMessage || '保存失败')
          return
        }
      } else if (!response.success) {
        console.error('Contest content save response:', response); toast.error('保存失败')
        return
      }
      toast.success(`比赛${value.kind === 'statement' ? '题面' : '题解'}已更新`)
      await onSaved(value.kind)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const isPdf = value?.format === 'pdf'
  return (
    <FormDialog
      isOpen={isOpen && !!value}
      onClose={onClose}
      title={`编辑比赛${value?.kind === 'statement' ? '题面' : '题解'} · ${value?.label || ''}`}
      size="xl"
      footer={<div className={unifiedStyles.u1}><Button variant="ghost" onClick={onClose} disabled={saving}>取消</Button><Button variant="ghost" onClick={save} disabled={saving || (!isPdf && !content.trim())}>{saving ? '保存中…' : '保存'}</Button></div>}
    >
      <div className={unifiedStyles.u2}>本次编辑只影响当前比赛；题库原内容和其他比赛不会改变。</div>
      {isPdf ? (
        <div className={unifiedStyles.u3}>
          {value?.fileUrl && <a href={value.fileUrl} target="_blank" rel="noreferrer" className={unifiedStyles.u4}>查看当前 PDF</a>}
          <label className={unifiedStyles.u5}>替换 PDF（最大 20MB）<Input type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] || null)} className={unifiedStyles.u6} /></label>
        </div>
      ) : <MarkdownEditor value={content} onChange={setContent} minHeight="440px" showPreview />}
    </FormDialog>
  )
}
