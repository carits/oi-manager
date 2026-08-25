'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import unifiedStyles from './TrainingContentSelectionModal.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import { FormDialog } from '@/components/ui/Dialogs'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { useToast } from '@/components/ui/Toast'

interface ContentOption {
  key: string
  sourceType: 'canonical' | 'user' | 'training' | 'none'
  title: string | null
  format: string
  language: string | null
  authorUsername: string | null
  fileName: string | null
  previewText: string | null
}

interface ContentOptionsResponse {
  statement: ContentOption[]
  solution: ContentOption[]
  currentSelection: {
    statementOptionKey: string | null
    solutionOptionKey: string | null
    statementRevision: number | null
    solutionRevision: number | null
  }
}

interface Props {
  isOpen: boolean
  onClose: () => void
  trainingId: string
  trainingProblemId: string
  problemLabel: string
  onSaved: () => Promise<void> | void
}

function optionLabel(option: ContentOption) {
  if (option.sourceType === 'none') return '不提供题解'
  const source = option.sourceType === 'canonical' ? '官方' : `用户 · ${option.authorUsername || '匿名'}`
  const title = option.title || option.fileName || '未命名版本'
  const meta = [option.format.toUpperCase(), option.language].filter(Boolean).join(' · ')
  return `${source}｜${title}${meta ? `（${meta}）` : ''}`
}

export function TrainingContentSelectionModal({
  isOpen,
  onClose,
  trainingId,
  trainingProblemId,
  problemLabel,
  onSaved,
}: Props) {
  const toast = useToast()
  const [data, setData] = useState<ContentOptionsResponse | null>(null)
  const [statementKey, setStatementKey] = useState('')
  const [solutionKey, setSolutionKey] = useState('none')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ title: string; content: string | null; fileUrl: string | null } | null>(null)

  const base = `/api/trainings/${trainingId}/problems/${trainingProblemId}`
  const load = useCallback(async () => {
    if (!isOpen || !trainingProblemId) return
    setLoading(true)
    setPreview(null)
    const response = await apiClient.get<ContentOptionsResponse>(`${base}/content-options`)
    if (response.success && response.data) {
      setData(response.data)
      setStatementKey(response.data.currentSelection.statementOptionKey || response.data.statement[0]?.key || '')
      setSolutionKey(response.data.currentSelection.solutionOptionKey || 'none')
    } else {
      toast.error(response.message || '加载内容版本失败')
    }
    setLoading(false)
  }, [base, isOpen, trainingProblemId, toast])

  useEffect(() => { void load() }, [load])

  const changed = useMemo(() => !!data && solutionKey !== (data.currentSelection.solutionOptionKey || 'none'), [data, solutionKey])

  const showPreview = async (kind: 'statement' | 'solution') => {
    const key = kind === 'statement' ? statementKey : solutionKey
    if (!key || key === 'none') {
      setPreview({ title: '题解预览', content: '当前选择不提供题解。', fileUrl: null })
      return
    }
    const response = await apiClient.get<ContentOption & { content: string | null; fileUrl: string | null }>(
      `${base}/content-options/${encodeURIComponent(key)}/preview`,
    )
    if (!response.success || !response.data) {
      toast.error(response.message || '预览失败')
      return
    }
    setPreview({
      title: `${kind === 'statement' ? '题面' : '题解'}预览 · ${optionLabel(response.data)}`,
      content: response.data.content,
      fileUrl: response.data.fileUrl,
    })
  }

  const save = async () => {
    if (!statementKey) return
    setSaving(true)
    const response = await apiClient.put(`${base}/content-selection`, {
      statementOptionKey: statementKey,
      solutionOptionKey: solutionKey,
    })
    if (response.success) {
      toast.success('活动内容版本已更新，旧快照已保留')
      await onSaved()
      onClose()
    } else toast.error(response.message || '保存失败')
    setSaving(false)
  }

  const selectStyle: React.CSSProperties = {
    width: '100%', padding: '0.65rem 0.75rem', border: '1px solid var(--border)', borderRadius: '8px',
    background: 'white', fontSize: '0.9rem',
  }

  return (
    <FormDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`选择活动题解 · ${problemLabel}`}
      size="lg"
      footer={(
        <div className={unifiedStyles.u1}>
          <Button variant="ghost" onClick={onClose} className={unifiedStyles.u2}>取消</Button>
          <Button variant="ghost" onClick={save} disabled={!changed || saving || loading} style={{ padding: '0.6rem 1.1rem', border: 'none', borderRadius: '7px', background: changed ? 'var(--primary)' : 'var(--gray-300)', color: 'white', cursor: changed ? 'pointer' : 'not-allowed' }}>
            {saving ? '保存中…' : '应用新版本'}
          </Button>
        </div>
      )}
    >
      {loading || !data ? <div className={unifiedStyles.u3}>正在加载可用版本…</div> : (
        <div className={unifiedStyles.u4}>
          <p className={unifiedStyles.u5}>
            此处只选择当前题目的活动题解。题面请前往独立的“题面选择”页面统一配置。
          </p>
          {([
            { kind: 'solution' as const, label: '活动题解', value: solutionKey, setValue: setSolutionKey, options: data.solution, revision: data.currentSelection.solutionRevision },
          ]).map(item => (
            <section key={item.kind} className={unifiedStyles.u6}>
              <div className={unifiedStyles.u7}>
                <strong>{item.label}</strong>
                {item.revision && <span className={unifiedStyles.u8}>当前 revision {item.revision}</span>}
              </div>
              <div className={unifiedStyles.u9}>
                <Select aria-label={item.label} value={item.value} onChange={event => item.setValue(event.target.value)} style={selectStyle}>
                  {item.options.map(option => <option key={option.key} value={option.key}>{optionLabel(option)}</option>)}
                </Select>
                <Button variant="ghost" onClick={() => showPreview(item.kind)} className={unifiedStyles.u10}>预览</Button>
              </div>
            </section>
          ))}
          {preview && (
            <section className={unifiedStyles.u11}>
              <strong>{preview.title}</strong>
              <div className={unifiedStyles.u12}>
                {preview.fileUrl ? <a href={preview.fileUrl} target="_blank" rel="noreferrer">在新窗口查看 PDF</a> : <MarkdownRenderer content={preview.content || '暂无内容'} />}
              </div>
            </section>
          )}
        </div>
      )}
    </FormDialog>
  )
}
