'use client'

import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import type { TrainingInfo, TrainingProblem, ProblemDetail, Attachment } from '../types'

const STATEMENT_LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English'
}

function toExcelColumnName(index: number): string {
  let result = ''
  let i = index
  while (i >= 0) {
    result = String.fromCharCode(65 + (i % 26)) + result
    i = Math.floor(i / 26) - 1
  }
  return result
}

function getPdfUrl(fileUrl: string): string | null {
  if (!fileUrl) return null
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
  if (fileUrl.startsWith('/')) return `${apiUrl}${fileUrl}`
  return fileUrl
}

interface TrainingProblemDetailProps {
  problems: TrainingProblem[]
  selectedProblemId: string | null
  setSelectedProblemId: (id: string) => void
  problemDetail: ProblemDetail | null
  selectedStatementId: string | null
  setSelectedStatementId: (id: string | null) => void
  training: TrainingInfo
  noteContent: string
  setNoteContent: (v: string) => void
  showNotePanel: boolean
  setShowNotePanel: (v: boolean) => void
  noteSaving: boolean
  isOngoing: boolean
  onSubmitClick: () => void
  onGoToAttachments: () => void
}

export function TrainingProblemDetail({
  problems,
  selectedProblemId,
  setSelectedProblemId,
  problemDetail,
  selectedStatementId,
  setSelectedStatementId,
  training,
  noteContent,
  setNoteContent,
  showNotePanel,
  setShowNotePanel,
  noteSaving,
  isOngoing,
  onSubmitClick,
  onGoToAttachments,
}: TrainingProblemDetailProps) {
  const selectedProblem = problems.find(p => p.id === selectedProblemId)

  return (
    <div style={{ display: 'flex', gap: '1rem' }}>
      {/* 左侧：题目按钮 */}
      <div style={{ width: '200px', flexShrink: 0 }}>
        <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {problems.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedProblemId(p.id)}
                style={{
                  padding: '0.3rem 0.5rem',
                  border: '1px solid',
                  borderColor: selectedProblemId === p.id ? 'var(--primary)' : 'var(--border)',
                  background: selectedProblemId === p.id ? 'var(--primary)' : 'white',
                  color: selectedProblemId === p.id ? 'white' : 'var(--gray-700)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  minWidth: '28px',
                }}
              >
                {toExcelColumnName(p.orderIndex)}
              </button>
            ))}
            {problems.length === 0 && (
              <div style={{ color: 'var(--gray-400)', fontSize: '0.85rem' }}>暂无题目</div>
            )}
          </div>
        </div>
      </div>

      {/* 中间：题面内容 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
          {problemDetail ? (
            <>
              {/* Problem Header */}
              <div style={{ padding: '0.5rem 1rem', background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--gray-800)' }}>{problemDetail.alias || problemDetail.problemTitle || '未命名'}</span>
                {problemDetail.points != null && <span>分值: {problemDetail.points}</span>}
                {problemDetail.timeLimit && <span>时间: {problemDetail.timeLimit}s</span>}
                {problemDetail.memoryLimit && <span>内存: {problemDetail.memoryLimit}MB</span>}
                {problemDetail.difficulty && (
                  <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', background: problemDetail.difficulty === '简单' ? 'var(--success-light)' : problemDetail.difficulty === '中等' ? 'var(--warning-light)' : 'var(--error-light)', color: problemDetail.difficulty === '简单' ? 'var(--success-text)' : problemDetail.difficulty === '中等' ? 'var(--warning-text)' : 'var(--error-text)' }}>
                    {problemDetail.difficulty}
                  </span>
                )}
                {training.isAdmin && problemDetail.problemTitle && (
                  <>
                    <div style={{ width: '1px', height: '12px', background: 'var(--border)' }} />
                    <span style={{ color: 'var(--primary)' }}>{problemDetail.platformProblemId}</span>
                    <span>{problemDetail.problemTitle}</span>
                    <span style={{ color: 'var(--gray-400)' }}>({problemDetail.platform})</span>
                  </>
                )}
              </div>
              {/* Statement Version Selector */}
              {(() => {
                const visibleStatements = (problemDetail.statements || []).filter(s => true)
                return visibleStatements.length > 1 && (
                  <div style={{
                    padding: '0.5rem 1rem',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <select
                      value={selectedStatementId || ''}
                      onChange={(e) => {
                        const id = e.target.value
                        setSelectedStatementId(id)
                        if (selectedProblemId) {
                          const stmt = visibleStatements.find(s => s.id === id)
                          if (stmt) {
                            localStorage.setItem(`training-stmt-pref-${selectedProblemId}`, `${stmt.format}-${stmt.language || 'unknown'}`)
                          }
                        }
                      }}
                      style={{
                        padding: '0.25rem 0.5rem',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        background: 'white'
                      }}
                    >
                      {visibleStatements.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.format === 'pdf' ? 'PDF' : `${s.language ? STATEMENT_LANGUAGE_LABELS[s.language] || s.language : '未知'}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })()}
              {/* Statement Content */}
              <div style={{ padding: '1.5rem' }}>
                {(() => {
                  const visibleStatements = (problemDetail.statements || []).filter(s => true)
                  if (visibleStatements.length === 0 && problemDetail.description) {
                    return <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}><MarkdownRenderer content={problemDetail.description} /></div>
                  }
                  const currentStatement = selectedStatementId
                    ? visibleStatements.find(s => s.id === selectedStatementId)
                    : visibleStatements.find(s => s.format === 'markdown' && s.language === 'zh')
                      || visibleStatements.find(s => s.format === 'markdown')
                      || visibleStatements[0]
                  if (!currentStatement) {
                    return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>暂无题面</div>
                  }
                  if (currentStatement.format === 'pdf' && currentStatement.fileUrl) {
                    const pdfUrl = getPdfUrl(currentStatement.fileUrl)
                    if (pdfUrl && pdfUrl.startsWith('/')) {
                      return <iframe src={pdfUrl} style={{ width: '100%', height: '600px', border: 'none' }} />
                    }
                    return (
                      <div style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>题面为外部 PDF 文件，请在新窗口中查看</p>
                        <a
                          href={currentStatement.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-block',
                            padding: '0.5rem 1.5rem',
                            backgroundColor: 'var(--primary)',
                            color: 'var(--text-inverse)',
                            borderRadius: '6px',
                            textDecoration: 'none',
                            fontSize: '0.875rem',
                          }}
                        >
                          打开 PDF 题面
                        </a>
                      </div>
                    )
                  }
                  if (currentStatement.content) {
                    return <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}><MarkdownRenderer content={currentStatement.content} /></div>
                  }
                  return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>暂无题面</div>
                })()}
              </div>
            </>
          ) : (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--gray-400)' }}>
              {problems.length > 0 ? '请选择左侧题目查看' : '暂无题目'}
            </div>
          )}
        </div>

        {/* 思路面板 */}
        {showNotePanel && (
          <div style={{ marginTop: '1rem', background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>思路记录</span>
              {noteSaving && <span style={{ color: 'var(--warning-text)', fontSize: '0.7rem' }}>保存中...</span>}
            </div>
            <textarea
              value={noteContent}
              onChange={e => setNoteContent(e.target.value)}
              placeholder="在这里记录你的解题思路..."
              rows={8}
              style={{
                width: '100%', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '6px',
                fontSize: '0.85rem', fontFamily: 'Consolas, Monaco, monospace', lineHeight: 1.5,
                resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          </div>
        )}
      </div>

      {/* 右侧：操作按钮 */}
      <div style={{ width: '150px', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button
            onClick={() => setShowNotePanel(!showNotePanel)}
            style={{
              padding: '0.6rem 1rem',
              background: showNotePanel ? 'var(--bg-hover)' : 'var(--primary)',
              color: showNotePanel ? 'var(--text-secondary)' : 'white',
              border: showNotePanel ? '1px solid var(--border)' : 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.85rem',
              fontWeight: 500,
              width: '100%',
            }}
          >
            ✏️ {showNotePanel ? '关闭思路' : '写思路'}
          </button>
          <button
            onClick={onSubmitClick}
            style={{
              padding: '0.6rem 1rem',
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: isOngoing && (selectedProblem?.platform === 'carits' || selectedProblem?.platform === 'hdu') ? 'pointer' : 'not-allowed',
              fontSize: '0.85rem',
              fontWeight: 500,
              width: '100%',
              opacity: isOngoing && (selectedProblem?.platform === 'carits' || selectedProblem?.platform === 'hdu') ? 1 : 0.5,
            }}
            disabled={!isOngoing || (selectedProblem?.platform !== 'carits' && selectedProblem?.platform !== 'hdu')}
          >
            ▶ 提交代码
          </button>
          {!isOngoing && (
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', textAlign: 'center' }}>
              训练未开始
            </div>
          )}
          {(selectedProblem?.attachmentCount ?? 0) > 0 && (
            <button
              onClick={onGoToAttachments}
              style={{
                padding: '0.6rem 1rem',
                background: 'white',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 500,
                width: '100%',
              }}
            >
              📎 附件 ({selectedProblem?.attachmentCount ?? 0})
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
