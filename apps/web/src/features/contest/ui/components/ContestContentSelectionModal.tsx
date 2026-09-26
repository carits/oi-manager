'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import unifiedStyles from './ContestContentSelectionModal.unified.module.css'
import { Select } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import type { ContestContentOption, ContestContentOptions } from '@oi-manager/contracts'
import { getContestContentOptions, previewContestContentOption, updateContestContentSelection } from '../../api/contestApi'
import { FormDialog } from '@/components/ui/Dialogs'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { useToast } from '@/components/ui/Toast'

interface Props {
  isOpen: boolean
  onClose: () => void
  contestId: string
  contestProblemId: string
  problemLabel: string
  onSaved: () => Promise<void> | void
}

function optionLabel(option: ContestContentOption) {
  if (option.sourceType === 'none') return '不提供题解'
  const source = option.sourceType === 'canonical' ? '官方' : `用户 · ${option.authorUsername || '匿名'}`
  const title = option.title || option.fileName || '未命名版本'
  const meta = [option.format.toUpperCase(), option.language].filter(Boolean).join(' · ')
  return `${source}｜${title}${meta ? `（${meta}）` : ''}`
}

export function ContestContentSelectionModal({
  isOpen,
  onClose,
  contestId,
  contestProblemId,
  problemLabel,
  onSaved,
}: Props) {
  const toast = useToast()
  const [data, setData] = useState<ContestContentOptions | null>(null)
  const [statementKey, setStatementKey] = useState('')
  const [solutionKey, setSolutionKey] = useState('none')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ title: string; content: string | null; fileUrl: string | null } | null>(null)

  const load = useCallback(async () => {
    if (!isOpen || !contestProblemId) return
    setLoading(true)
    setPreview(null)
    try {
      const response = await getContestContentOptions(contestId, contestProblemId)
      setData(response)
      setStatementKey(response.currentSelection.statementOptionKey || response.statement[0]?.key || '')
      setSolutionKey(response.currentSelection.solutionOptionKey || 'none')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载内容版本失败')
    } finally {
      setLoading(false)
    }
  }, [isOpen, contestId, contestProblemId, toast])

  useEffect(() => { void load() }, [load])

  const changed = useMemo(() => !!data && solutionKey !== (data.currentSelection.solutionOptionKey || 'none'), [data, solutionKey])

  const showPreview = async (kind: 'statement' | 'solution') => {
    const key = kind === 'statement' ? statementKey : solutionKey
    if (!key || key === 'none') {
      setPreview({ title: '题解预览', content: '当前选择不提供题解。', fileUrl: null })
      return
    }
    try {
      const response = await previewContestContentOption(contestId, contestProblemId, key)
      setPreview({
        title: `${kind === 'statement' ? '题面' : '题解'}预览 · ${optionLabel(response)}`,
        content: response.content,
        fileUrl: response.fileUrl,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '预览失败')
    }
  }

  const save = async () => {
    if (!statementKey) return
    setSaving(true)
    try {
      const response = await updateContestContentSelection(contestId, contestProblemId, {
        statementOptionKey: statementKey,
        solutionOptionKey: solutionKey,
      })
      if (!response.ok) {
        toast.error(response.error.message || '保存失败')
        return
      }
      toast.success('活动内容版本已更新')
      await onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
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
          <Button variant="primary" onClick={save} disabled={!changed || saving || loading}>
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
                <Select aria-label={item.label} value={item.value} onChange={event => item.setValue(event.target.value)}>
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
