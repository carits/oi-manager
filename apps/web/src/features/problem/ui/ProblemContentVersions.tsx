'use client'

import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import unifiedStyles from './ProblemForm.unified.module.css'

export type ProblemContentVersion = {
  id?: string
  format: 'markdown' | 'pdf'
  language: 'zh' | 'en' | null
  content: string | null
  fileUrl: string | null
  isVisible: boolean
}

type Props = {
  kind: 'statement' | 'solution'
  items: ProblemContentVersion[]
  mode: 'create' | 'edit'
  problemId?: string
  editMode: 'edit' | 'preview'
  onEditModeChange: (mode: 'edit' | 'preview') => void
  onUpdate: (index: number, updates: Partial<ProblemContentVersion>) => void
  onRemove: (index: number) => void
  onAdd: (format: 'markdown' | 'pdf', language: 'zh' | 'en' | null) => void
  onUploadPdf: (index: number, file: File) => void
}

const languageLabels: Record<string, string> = { zh: '中文', en: 'English' }

export function ProblemContentVersions({
  kind,
  items,
  mode,
  problemId,
  editMode,
  onEditModeChange,
  onUpdate,
  onRemove,
  onAdd,
  onUploadPdf,
}: Props) {
  const isStatement = kind === 'statement'
  const noun = isStatement ? '题面' : '题解'
  const has = (format: 'markdown' | 'pdf', language: 'zh' | 'en' | null) =>
    items.some((item) => item.format === format && item.language === language)

  return (
    <div>
      {items.map((item, index) => (
        <div key={item.id || `${item.format}-${item.language}-${index}`} className={unifiedStyles.u13}>
          <div className={unifiedStyles.u14}>
            <span className={unifiedStyles.u15}>
              {!isStatement && `${noun} - `}
              {item.format === 'pdf'
                ? 'PDF'
                : item.language
                  ? languageLabels[item.language]
                  : '未知'}
            </span>
            <div className={unifiedStyles.u16}>
              <label className={unifiedStyles.u17}>
                <Input
                  type="checkbox"
                  checked={item.isVisible}
                  onChange={(event) => onUpdate(index, { isVisible: event.target.checked })}
                />
                可见
              </label>
              <Button
                variant="ghost"
                type="button"
                onClick={() => onRemove(index)}
                className={unifiedStyles.u18}
              >
                删除
              </Button>
            </div>
          </div>
          <div className={unifiedStyles.u19}>
            {item.format === 'markdown' ? (
              isStatement ? (
                <div>
                  <div className={unifiedStyles.u20}>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => onEditModeChange('edit')}
                      className={unifiedStyles.editorModeButton}
                      aria-pressed={editMode === 'edit'}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => onEditModeChange('preview')}
                      className={unifiedStyles.editorModeButton}
                      aria-pressed={editMode === 'preview'}
                    >
                      预览
                    </Button>
                  </div>
                  {editMode === 'edit' ? (
                    <Textarea
                      value={item.content || ''}
                      onChange={(event) => onUpdate(index, { content: event.target.value })}
                      className={unifiedStyles.u21}
                      placeholder="请输入题面内容（支持 Markdown 和 LaTeX）"
                    />
                  ) : (
                    <div className={unifiedStyles.u22}>
                      {item.content ? (
                        <MarkdownRenderer content={item.content} />
                      ) : (
                        <span className={unifiedStyles.u23}>暂无内容</span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <Textarea
                  value={item.content || ''}
                  onChange={(event) => onUpdate(index, { content: event.target.value })}
                  className={unifiedStyles.u29}
                  placeholder="请输入题解内容（支持 Markdown 和 LaTeX）"
                />
              )
            ) : mode === 'edit' && problemId ? (
              <div>
                <Input
                  type="file"
                  accept=".pdf"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) onUploadPdf(index, file)
                  }}
                  className={unifiedStyles.u24}
                />
                {item.fileUrl && <p className={unifiedStyles.u25}>已上传 PDF</p>}
              </div>
            ) : (
              <p className={unifiedStyles.u26}>请先保存题目后再上传 PDF</p>
            )}
          </div>
        </div>
      ))}
      <div className={unifiedStyles.u27}>
        <Select
          aria-label={`添加${noun}版本`}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'markdown-zh') onAdd('markdown', 'zh')
            else if (value === 'markdown-en') onAdd('markdown', 'en')
            else if (value === 'pdf') onAdd('pdf', null)
            event.target.value = ''
          }}
          className={unifiedStyles.u28}
        >
          <option value="">+ 添加{noun}版本</option>
          <option value="markdown-zh" disabled={has('markdown', 'zh')}>
            Markdown 中文 {has('markdown', 'zh') ? '(已添加)' : ''}
          </option>
          <option value="markdown-en" disabled={has('markdown', 'en')}>
            Markdown 英文 {has('markdown', 'en') ? '(已添加)' : ''}
          </option>
          <option value="pdf" disabled={has('pdf', null)}>
            上传 PDF {has('pdf', null) ? '(已添加)' : ''}
          </option>
        </Select>
      </div>
    </div>
  )
}
