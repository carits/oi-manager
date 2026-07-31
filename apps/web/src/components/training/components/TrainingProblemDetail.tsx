'use client'

import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { LoadError } from '@/components/ui/LoadError'
import type { ResourceState } from '@/lib/resource'
import type { TrainingInfo, TrainingProblem, ProblemDetail } from '../types'

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
  problemDetailState: ResourceState<ProblemDetail>
  retryProblemDetail: () => Promise<void>
  selectedStatementId: string | null
  setSelectedStatementId: (id: string | null) => void
  training: TrainingInfo
  noteContent: string
  setNoteContent: (v: string) => void
  noteSaving: boolean
  noteLastSaved: Date | null
  noteEditMode: 'edit' | 'preview' | 'split'
  setNoteEditMode: (v: 'edit' | 'preview' | 'split') => void
  editModeActive: boolean
  setEditModeActive: (v: boolean) => void
  recordContent: string
  setRecordContent: (v: string) => void
  recordSaving: boolean
  recordLastSaved: Date | null
  recordEditMode: 'edit' | 'preview' | 'split'
  setRecordEditMode: (v: 'edit' | 'preview' | 'split') => void
  trainingStatus: 'upcoming' | 'ongoing' | 'finished'
  onSubmitClick: () => void
  onGoToAttachments: () => void
  saveNoteNow: () => Promise<void>
  saveRecordNow: () => Promise<void>
}

export function TrainingProblemDetail({
  problems,
  selectedProblemId,
  setSelectedProblemId,
  problemDetail,
  problemDetailState,
  retryProblemDetail,
  selectedStatementId,
  setSelectedStatementId,
  training,
  noteContent,
  setNoteContent,
  noteSaving,
  noteLastSaved,
  noteEditMode,
  setNoteEditMode,
  editModeActive,
  setEditModeActive,
  recordContent,
  setRecordContent,
  recordSaving,
  recordLastSaved,
  recordEditMode,
  setRecordEditMode,
  trainingStatus,
  onSubmitClick,
  onGoToAttachments,
  saveNoteNow,
  saveRecordNow,
}: TrainingProblemDetailProps) {
  const selectedProblem = problems.find(p => p.id === selectedProblemId)

  // ========== 题面内容渲染（两种布局共用） ==========

  const renderStatementContent = () => {
    if (problemDetailState.state === 'pending') {
      return <SkeletonRegion rows={8} label="题面正在准备" />
    }

    if (problemDetailState.state === 'error' && !problemDetail) {
      return (
        <LoadError
          message={problemDetailState.error.message}
          requestId={problemDetailState.error.requestId}
          onRetry={retryProblemDetail}
        />
      )
    }

    if (!problemDetail) {
      return (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          {problems.length > 0 ? '请选择题目查看' : '暂无题目'}
        </div>
      )
    }

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
      return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>暂无题面</div>
    }
    if (currentStatement.format === 'pdf' && currentStatement.fileUrl) {
      const pdfUrl = getPdfUrl(currentStatement.fileUrl)
      if (pdfUrl && pdfUrl.startsWith('/')) {
        return <iframe src={pdfUrl} style={{ width: '100%', height: '600px', border: 'none' }} />
      }
      return (
        <div style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>题面为外部 PDF 文件，请在新窗口中查看</p>
          <a href={currentStatement.fileUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', padding: '0.5rem 1.5rem', backgroundColor: 'var(--primary)', color: 'var(--text-inverse)', borderRadius: '6px', textDecoration: 'none', fontSize: '0.875rem' }}>
            打开 PDF 题面
          </a>
        </div>
      )
    }
    if (currentStatement.content) {
      return <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}><MarkdownRenderer content={currentStatement.content} /></div>
    }
    return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>暂无题面</div>
  }

  const renderStatementSelector = () => {
    const visibleStatements = (problemDetail?.statements || []).filter(s => true)
    if (visibleStatements.length <= 1) return null
    return (
      <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <select aria-label="选择"
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
          style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', background: 'white' }}
        >
          {visibleStatements.map((s) => (
            <option key={s.id} value={s.id}>
              {s.format === 'pdf' ? 'PDF' : `${s.language ? STATEMENT_LANGUAGE_LABELS[s.language] || s.language : '未知'}`}
            </option>
          ))}
        </select>
      </div>
    )
  }

  // ========== 题目按钮渲染 ==========

  const renderProblemButtons = (compact: boolean) => (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
      {problems.map(p => (
        <button
          key={p.id}
          onClick={() => setSelectedProblemId(p.id)}
          style={{
            padding: compact ? '0.2rem 0.4rem' : '0.3rem 0.5rem',
            border: '1px solid',
            borderColor: selectedProblemId === p.id ? 'var(--primary)' : 'var(--border)',
            background: selectedProblemId === p.id ? 'var(--primary)' : 'white',
            color: selectedProblemId === p.id ? 'white' : 'var(--text-primary)',
            borderRadius: compact ? '4px' : '6px',
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
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>暂无题目</div>
      )}
    </div>
  )

  // ========== 题目信息行 ==========

  const renderProblemInfo = () => {
    if (!problemDetail) return null
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>{problemDetail.alias || problemDetail.problemTitle || '未命名'}</span>
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
            <span style={{ color: 'var(--text-muted)' }}>({problemDetail.platform})</span>
          </>
        )}
      </div>
    )
  }

  // ========== 编辑器内容渲染 ==========

  const renderEditorContent = () => {
    if (training.type === 'contest') {
      // 比赛记录编辑器
      return (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {(recordEditMode === 'edit' || recordEditMode === 'split') && (
            <textarea
              value={recordContent}
              onChange={e => setRecordContent(e.target.value)}
              placeholder={`在这里记录你的比赛心得...

例如：
## 比赛策略
这场比赛我打算先做...

## 每题思路
A 题：...
B 题：...

## 赛后总结
这次比赛暴露了...`}
              style={{
                flex: recordEditMode === 'split' ? 1 : undefined,
                width: recordEditMode === 'edit' ? '100%' : undefined,
                minHeight: '100%',
                padding: '0.75rem',
                border: 'none',
                fontSize: '0.85rem',
                fontFamily: 'Consolas, Monaco, monospace',
                lineHeight: 1.6,
                resize: 'none',
                background: recordEditMode === 'split' ? 'var(--bg-muted)' : 'white',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              spellCheck={false}
            />
          )}
          {recordEditMode === 'split' && <div style={{ width: '1px', background: 'var(--border)' }} />}
          {(recordEditMode === 'preview' || recordEditMode === 'split') && (
            <div style={{
              flex: recordEditMode === 'split' ? 1 : undefined,
              width: recordEditMode === 'preview' ? '100%' : undefined,
              minHeight: '100%',
              padding: '0.75rem',
              overflow: 'auto',
              background: 'white',
              boxSizing: 'border-box',
            }}>
              {recordContent.trim() ? (
                <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}>
                  <MarkdownRenderer content={recordContent} />
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
                  暂无内容，开始编辑...
                </div>
              )}
            </div>
          )}
        </div>
      )
    } else {
      // 训练思路编辑器
      return (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {(noteEditMode === 'edit' || noteEditMode === 'split') && (
            <textarea
              value={noteContent}
              onChange={e => setNoteContent(e.target.value)}
              placeholder={`在这里记录你的解题思路...

例如：
## 题目分析
这道题的核心问题是...

## 思路过程
1. 首先考虑暴力解法...
2. 发现可以优化...

## 代码实现
\`\`\`cpp
// 核心代码
\`\`\`

## 复杂度分析
- 时间复杂度：O(n)
- 空间复杂度：O(n)`}
              style={{
                flex: noteEditMode === 'split' ? 1 : undefined,
                width: noteEditMode === 'edit' ? '100%' : undefined,
                minHeight: '100%',
                padding: '0.75rem',
                border: 'none',
                fontSize: '0.85rem',
                fontFamily: 'Consolas, Monaco, monospace',
                lineHeight: 1.6,
                resize: 'none',
                background: noteEditMode === 'split' ? 'var(--bg-muted)' : 'white',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              spellCheck={false}
            />
          )}
          {noteEditMode === 'split' && <div style={{ width: '1px', background: 'var(--border)' }} />}
          {(noteEditMode === 'preview' || noteEditMode === 'split') && (
            <div style={{
              flex: noteEditMode === 'split' ? 1 : undefined,
              width: noteEditMode === 'preview' ? '100%' : undefined,
              minHeight: '100%',
              padding: '0.75rem',
              overflow: 'auto',
              background: 'white',
              boxSizing: 'border-box',
            }}>
              {noteContent.trim() ? (
                <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}>
                  <MarkdownRenderer content={noteContent} />
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
                  暂无内容，开始编辑...
                </div>
              )}
            </div>
          )}
        </div>
      )
    }
  }

  // ========== 保存按钮渲染 ==========

  const renderSaveButton = () => {
    const handleSave = training.type === 'contest' ? saveRecordNow : saveNoteNow
    const isSaving = training.type === 'contest' ? recordSaving : noteSaving
    return (
      <button
        onClick={handleSave}
        disabled={isSaving}
        style={{
          padding: '0.2rem 0.6rem',
          background: isSaving ? 'var(--gray-300)' : 'var(--primary)',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          cursor: isSaving ? 'not-allowed' : 'pointer',
          fontSize: '0.7rem',
          fontWeight: 500,
        }}
      >
        {isSaving ? '保存中...' : '保存'}
      </button>
    )
  }

  // ========== 保存状态渲染 ==========

  const renderSaveStatus = () => {
    if (training.type === 'contest') {
      return (
        <>
          {recordSaving && <span style={{ color: 'var(--warning-text)', fontSize: '0.7rem' }}>保存中...</span>}
          {recordLastSaved && !recordSaving && <span style={{ color: 'var(--success-text)', fontSize: '0.7rem' }}>已保存 {recordLastSaved.toLocaleTimeString()}</span>}
          {!recordSaving && !recordLastSaved && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>输入后自动保存</span>}
        </>
      )
    } else {
      return (
        <>
          {noteSaving && <span style={{ color: 'var(--warning-text)', fontSize: '0.7rem' }}>保存中...</span>}
          {noteLastSaved && !noteSaving && <span style={{ color: 'var(--success-text)', fontSize: '0.7rem' }}>已保存 {noteLastSaved.toLocaleTimeString()}</span>}
          {!noteSaving && !noteLastSaved && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>输入后自动保存</span>}
        </>
      )
    }
  }

  // ========== 模式切换按钮渲染 ==========

  const renderModeButtons = () => {
    if (training.type === 'contest') {
      return (
        <>
          <button onClick={() => setRecordEditMode('edit')} style={{ padding: '0.2rem 0.5rem', border: 'none', borderRadius: 'var(--radius-sm)', background: recordEditMode === 'edit' ? 'var(--primary)' : 'transparent', color: recordEditMode === 'edit' ? 'white' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}>编辑</button>
          <button onClick={() => setRecordEditMode('preview')} style={{ padding: '0.2rem 0.5rem', border: 'none', borderRadius: 'var(--radius-sm)', background: recordEditMode === 'preview' ? 'var(--primary)' : 'transparent', color: recordEditMode === 'preview' ? 'white' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}>预览</button>
          <button onClick={() => setRecordEditMode('split')} style={{ padding: '0.2rem 0.5rem', border: 'none', borderRadius: 'var(--radius-sm)', background: recordEditMode === 'split' ? 'var(--primary)' : 'transparent', color: recordEditMode === 'split' ? 'white' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}>分栏</button>
        </>
      )
    } else {
      return (
        <>
          <button onClick={() => setNoteEditMode('edit')} style={{ padding: '0.2rem 0.5rem', border: 'none', borderRadius: 'var(--radius-sm)', background: noteEditMode === 'edit' ? 'var(--primary)' : 'transparent', color: noteEditMode === 'edit' ? 'white' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}>编辑</button>
          <button onClick={() => setNoteEditMode('preview')} style={{ padding: '0.2rem 0.5rem', border: 'none', borderRadius: 'var(--radius-sm)', background: noteEditMode === 'preview' ? 'var(--primary)' : 'transparent', color: noteEditMode === 'preview' ? 'white' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}>预览</button>
          <button onClick={() => setNoteEditMode('split')} style={{ padding: '0.2rem 0.5rem', border: 'none', borderRadius: 'var(--radius-sm)', background: noteEditMode === 'split' ? 'var(--primary)' : 'transparent', color: noteEditMode === 'split' ? 'white' : 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem' }}>分栏</button>
        </>
      )
    }
  }

  // ========== 底部操作按钮 ==========

  const renderActionButtons = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <button
        onClick={onSubmitClick}
        style={{
          padding: '0.6rem 1rem',
          background: 'var(--primary)',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: trainingStatus === 'ongoing' && (selectedProblem?.platform === 'carits' || selectedProblem?.platform === 'hdu') ? 'pointer' : 'not-allowed',
          fontSize: '0.85rem',
          fontWeight: 500,
          width: '100%',
          opacity: trainingStatus === 'ongoing' && (selectedProblem?.platform === 'carits' || selectedProblem?.platform === 'hdu') ? 1 : 0.5,
        }}
        disabled={trainingStatus !== 'ongoing' || (selectedProblem?.platform !== 'carits' && selectedProblem?.platform !== 'hdu')}
      >
        ▶ 提交代码
      </button>
      {trainingStatus === 'upcoming' && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          {training.type === 'contest' ? '比赛未开始' : '训练未开始'}
        </div>
      )}
      {(selectedProblem?.attachmentCount ?? 0) > 0 && (trainingStatus !== 'upcoming' || training.isAdmin) && (
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
  )

  // ========== 两种布局 ==========

  if (editModeActive) {
    // 编辑模式：左右分栏
    return (
      <div style={{ display: 'flex', gap: '0.5rem', minHeight: '600px' }}>
        {/* 左侧：题面面板 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'white', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)' }}>
            {renderProblemButtons(true)}
            {renderProblemInfo()}
          </div>
          {renderStatementSelector()}
          <div style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }}>
            {renderStatementContent()}
          </div>
        </div>

        {/* 右侧：编辑器面板 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'white', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)', fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>{training.type === 'contest' ? '📝' : '✏️'}</span>
            <span>{training.type === 'contest' ? '比赛记录' : '思路记录'}</span>
            <div style={{ flex: 1 }} />
            {renderSaveButton()}
            {renderSaveStatus()}
            {renderModeButtons()}
            <button onClick={() => setEditModeActive(false)} style={{ padding: '0.2rem 0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'white', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.7rem', marginLeft: '0.25rem' }}>关闭</button>
          </div>
          {renderEditorContent()}
          <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid var(--border)' }}>
            {renderActionButtons()}
          </div>
        </div>
      </div>
    )
  }

  // 默认模式：原有三列布局
  return (
    <div style={{ display: 'flex', gap: '1rem' }}>
      {/* 左侧：题目按钮 */}
      <div style={{ width: '200px', flexShrink: 0 }}>
        <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '0.5rem' }}>
          {renderProblemButtons(false)}
        </div>
      </div>

      {/* 中间：题面内容 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
          {problemDetail ? (
            <>
              <div style={{ padding: '0.5rem 1rem', background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {renderProblemInfo()}
              </div>
              {renderStatementSelector()}
              <div style={{ padding: '1.5rem' }}>
                {renderStatementContent()}
              </div>
            </>
          ) : (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              {problems.length > 0 ? '请选择左侧题目查看' : '暂无题目'}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：操作按钮 */}
      <div style={{ width: '150px', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {(trainingStatus !== 'upcoming' || training.isAdmin) && (
            <button
              onClick={() => setEditModeActive(true)}
              style={{
                padding: '0.6rem 1rem',
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 500,
                width: '100%',
              }}
            >
              {training.type === 'contest' ? '📝 比赛记录' : '✏️ 写思路'}
            </button>
          )}
          {renderActionButtons()}
        </div>
      </div>
    </div>
  )
}
