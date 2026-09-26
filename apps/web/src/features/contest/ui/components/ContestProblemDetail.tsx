'use client'

import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import unifiedStyles from './ContestProblemDetail.unified.module.css'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { LoadError } from '@/components/ui/LoadError'
import type { ResourceState } from '@/lib/resource'
import type { ContestInfo, ContestProblem, ProblemDetail } from '../../model/types'
import { contestProblemCode, contestProblemTitle } from '../problem-label'
import { ContestHackSyncAction } from './ContestHackSyncAction'

const STATEMENT_LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English'
}

function getPdfUrl(fileUrl: string): string | null {
  if (!fileUrl) return null
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
  if (fileUrl.startsWith('/')) return `${apiUrl}${fileUrl}`
  return fileUrl
}

interface ContestProblemDetailProps {
  problems: ContestProblem[]
  selectedProblemId: string | null
  setSelectedProblemId: (id: string) => void
  problemDetail: ProblemDetail | null
  problemDetailState: ResourceState<ProblemDetail>
  retryProblemDetail: () => Promise<void>
  selectedStatementId: string | null
  setSelectedStatementId: (id: string | null) => void
  contest: ContestInfo
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
  onManageContentClick: () => void
  onEditStatement: (statement: ProblemDetail['statements'][number]) => void
  onGoToAttachments: () => void
  saveNoteNow: () => Promise<void>
  saveRecordNow: () => Promise<void>
}

export function ContestProblemDetail({
  problems,
  selectedProblemId,
  setSelectedProblemId,
  problemDetail,
  problemDetailState,
  retryProblemDetail,
  selectedStatementId,
  setSelectedStatementId,
  contest,
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
  onManageContentClick,
  onEditStatement,
  onGoToAttachments,
  saveNoteNow,
  saveRecordNow,
}: ContestProblemDetailProps) {
  const selectedProblem = problems.find(p => p.id === selectedProblemId)
  const hideProblemIdentity = !contest.isAdmin
    && !contest.problemIdVisible
    && trainingStatus !== 'finished'

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
        <div className={unifiedStyles.u1}>
          {problems.length > 0 ? '请选择题目查看' : '暂无题目'}
        </div>
      )
    }

    const visibleStatements = (problemDetail.statements || []).filter(s => true)
    if (visibleStatements.length === 0 && problemDetail.description) {
      return <div className={unifiedStyles.u2}><MarkdownRenderer content={problemDetail.description} /></div>
    }
    const currentStatement = selectedStatementId
      ? visibleStatements.find(s => s.id === selectedStatementId)
      : visibleStatements.find(s => s.format === 'markdown' && s.language === 'zh')
        || visibleStatements.find(s => s.format === 'markdown')
        || visibleStatements[0]
    if (!currentStatement) {
      return <div className={unifiedStyles.u3}>暂无题面</div>
    }
    const editAction = contest.isAdmin ? (
      <div className={unifiedStyles.u4}>
        <Button variant="ghost" onClick={() => onEditStatement(currentStatement)} className={unifiedStyles.u5}>编辑题面</Button>
      </div>
    ) : null
    if (currentStatement.format === 'pdf' && currentStatement.fileUrl) {
      const pdfUrl = getPdfUrl(currentStatement.fileUrl)
      if (pdfUrl && pdfUrl.startsWith('/')) {
        return <>{editAction}<iframe src={pdfUrl} className={unifiedStyles.u6} /></>
      }
      return (
        <><div>{editAction}</div><div className={unifiedStyles.u7}>
          <p className={unifiedStyles.u8}>题面为外部 PDF 文件，请在新窗口中查看</p>
          <a href={currentStatement.fileUrl} target="_blank" rel="noopener noreferrer" className={unifiedStyles.u9}>
            打开 PDF 题面
          </a>
        </div></>
      )
    }
    if (currentStatement.content) {
      return <>{editAction}<div className={unifiedStyles.u2}><MarkdownRenderer content={currentStatement.content} /></div></>
    }
    return <>{editAction}<div className={unifiedStyles.u3}>暂无题面</div></>
  }

  const renderStatementSelector = () => {
    const visibleStatements = (problemDetail?.statements || []).filter(s => true)
    if (visibleStatements.length === 0) return null
    return (
      <aside className={unifiedStyles.u10}>
        <div className={unifiedStyles.u11}>比赛题面</div>
        {visibleStatements.map(statement => (
          <Button variant="ghost" key={statement.id} onClick={() => {
            setSelectedStatementId(statement.id)
            if (selectedProblemId) localStorage.setItem(`contest-stmt-pref-${contest.id}-${selectedProblemId}`, statement.id)
          }} className={unifiedStyles.statementButton} aria-selected={selectedStatementId === statement.id}>
            <strong className={unifiedStyles.u12}>{statement.name || (statement.language ? STATEMENT_LANGUAGE_LABELS[statement.language] || statement.language : '题面')}</strong>
            <span className={unifiedStyles.u13}>{statement.authorUsername || 'System'} · {statement.isDefault ? '默认 · ' : ''}{statement.language || '未知'}</span>
          </Button>
        ))}
      </aside>
    )
  }

  // ========== 题目按钮渲染 ==========

  const renderProblemButtons = (compact: boolean) => (
    <div className={unifiedStyles.u14}>
      {problems.map(p => (
        <Button variant="ghost"
          key={p.id}
          onClick={() => setSelectedProblemId(p.id)}
          className={`${unifiedStyles.problemButton} ${compact ? unifiedStyles.problemButtonCompact : ''}`} aria-selected={selectedProblemId === p.id}
        >
          {contestProblemCode(p.orderIndex)}
        </Button>
      ))}
      {problems.length === 0 && (
        <div className={unifiedStyles.u15}>暂无题目</div>
      )}
    </div>
  )

  // ========== 题目信息行 ==========

  const renderProblemInfo = () => {
    if (!problemDetail) return null
    return (
      <div className={unifiedStyles.u16}>
        <span className={unifiedStyles.u17}>{problemDetail.alias || problemDetail.problemTitle || contestProblemTitle(selectedProblem || { orderIndex: problemDetail.orderIndex })}</span>
        {problemDetail.points != null && <span>分值: {problemDetail.points}</span>}
        {problemDetail.timeLimit && <span>时间: {problemDetail.timeLimit}ms</span>}
        {problemDetail.memoryLimit && <span>内存: {problemDetail.memoryLimit}MB</span>}
        {problemDetail.difficulty && (
          <span className={unifiedStyles.difficultyBadge} data-difficulty={problemDetail.difficulty}>
            {problemDetail.difficulty}
          </span>
        )}
        {contest.isAdmin && problemDetail.problemTitle && (
          <>
            <div className={unifiedStyles.u18} />
            <span className={unifiedStyles.u19}>{problemDetail.platformProblemId}</span>
            <span>{problemDetail.problemTitle}</span>
            <span className={unifiedStyles.u20}>({problemDetail.platform})</span>
          </>
        )}
      </div>
    )
  }

  // ========== 编辑器内容渲染 ==========

  const renderEditorContent = () => {
    if (contest.type === 'contest') {
      // 比赛记录编辑器
      return (
        <div className={unifiedStyles.u21}>
          {(recordEditMode === 'edit' || recordEditMode === 'split') && (
            <Textarea
              value={recordContent}
              onChange={e => setRecordContent(e.target.value)}
              placeholder={hideProblemIdentity ? `在这里记录你的比赛心得...

例如：
## 比赛策略
这场比赛我打算先做熟悉的题目。

## 解题思路
记录关键思路、边界和复盘内容。

## 赛后总结
这次比赛暴露了...` : `在这里记录你的比赛心得...

例如：
## 比赛策略
这场比赛我打算先做...

## 每题思路
A 题：...
B 题：...

## 赛后总结
这次比赛暴露了...`}
              className={`${unifiedStyles.contentEditor} ${recordEditMode === 'split' ? unifiedStyles.splitPane : unifiedStyles.fullPane}`}
              spellCheck={false}
            />
          )}
          {recordEditMode === 'split' && <div className={unifiedStyles.u22} />}
          {(recordEditMode === 'preview' || recordEditMode === 'split') && (
            <div className={`${unifiedStyles.contentPreview} ${recordEditMode === 'split' ? unifiedStyles.splitPane : unifiedStyles.fullPane}`}>
              {recordContent.trim() ? (
                <div className={unifiedStyles.u2}>
                  <MarkdownRenderer content={recordContent} />
                </div>
              ) : (
                <div className={unifiedStyles.u23}>
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
        <div className={unifiedStyles.u21}>
          {(noteEditMode === 'edit' || noteEditMode === 'split') && (
            <Textarea
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
              className={`${unifiedStyles.contentEditor} ${noteEditMode === 'split' ? unifiedStyles.splitPane : unifiedStyles.fullPane}`}
              spellCheck={false}
            />
          )}
          {noteEditMode === 'split' && <div className={unifiedStyles.u22} />}
          {(noteEditMode === 'preview' || noteEditMode === 'split') && (
            <div className={`${unifiedStyles.contentPreview} ${noteEditMode === 'split' ? unifiedStyles.splitPane : unifiedStyles.fullPane}`}>
              {noteContent.trim() ? (
                <div className={unifiedStyles.u2}>
                  <MarkdownRenderer content={noteContent} />
                </div>
              ) : (
                <div className={unifiedStyles.u23}>
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
    const handleSave = contest.type === 'contest' ? saveRecordNow : saveNoteNow
    const isSaving = contest.type === 'contest' ? recordSaving : noteSaving
    return (
      <Button variant="primary" size="sm"
        onClick={handleSave}
        disabled={isSaving}
      >
        {isSaving ? '保存中...' : '保存'}
      </Button>
    )
  }

  // ========== 保存状态渲染 ==========

  const renderSaveStatus = () => {
    if (contest.type === 'contest') {
      return (
        <>
          {recordSaving && <span className={unifiedStyles.u24}>保存中...</span>}
          {recordLastSaved && !recordSaving && <span className={unifiedStyles.u25}>已保存 {recordLastSaved.toLocaleTimeString()}</span>}
          {!recordSaving && !recordLastSaved && <span className={unifiedStyles.u26}>输入后自动保存</span>}
        </>
      )
    } else {
      return (
        <>
          {noteSaving && <span className={unifiedStyles.u24}>保存中...</span>}
          {noteLastSaved && !noteSaving && <span className={unifiedStyles.u25}>已保存 {noteLastSaved.toLocaleTimeString()}</span>}
          {!noteSaving && !noteLastSaved && <span className={unifiedStyles.u26}>输入后自动保存</span>}
        </>
      )
    }
  }

  // ========== 模式切换按钮渲染 ==========

  const renderModeButtons = () => {
    if (contest.type === 'contest') {
      return (
        <>
          <Button variant="ghost" onClick={() => setRecordEditMode('edit')} className={unifiedStyles.modeButton} aria-pressed={recordEditMode === 'edit'}>编辑</Button>
          <Button variant="ghost" onClick={() => setRecordEditMode('preview')} className={unifiedStyles.modeButton} aria-pressed={recordEditMode === 'preview'}>预览</Button>
          <Button variant="ghost" onClick={() => setRecordEditMode('split')} className={unifiedStyles.modeButton} aria-pressed={recordEditMode === 'split'}>分栏</Button>
        </>
      )
    } else {
      return (
        <>
          <Button variant="ghost" onClick={() => setNoteEditMode('edit')} className={unifiedStyles.modeButton} aria-pressed={noteEditMode === 'edit'}>编辑</Button>
          <Button variant="ghost" onClick={() => setNoteEditMode('preview')} className={unifiedStyles.modeButton} aria-pressed={noteEditMode === 'preview'}>预览</Button>
          <Button variant="ghost" onClick={() => setNoteEditMode('split')} className={unifiedStyles.modeButton} aria-pressed={noteEditMode === 'split'}>分栏</Button>
        </>
      )
    }
  }

  // ========== 底部操作按钮 ==========

  const renderActionButtons = () => (
    <div className={unifiedStyles.u27}>
      <Button variant="primary" fullWidth
        onClick={onSubmitClick}
        disabled={trainingStatus !== 'ongoing'}
      >
        ▶ 提交代码
      </Button>
      {selectedProblem && contest.isAdmin && (
        <ContestHackSyncAction contestId={contest.id} contestProblemId={selectedProblem.id} />
      )}
      {selectedProblem && contest.isAdmin && (
        <Button variant="ghost"
          onClick={onManageContentClick}
          className={unifiedStyles.u28}
        >
          题解选择
        </Button>
      )}
      {trainingStatus === 'upcoming' && (
        <div className={unifiedStyles.u29}>
          {contest.type === 'contest' ? '比赛未开始' : '训练未开始'}
        </div>
      )}
      {(selectedProblem?.attachmentCount ?? 0) > 0 && (trainingStatus !== 'upcoming' || contest.isAdmin) && (
        <Button variant="ghost"
          onClick={onGoToAttachments}
          className={unifiedStyles.u30}
        >
          题目资料 ({selectedProblem?.attachmentCount ?? 0})
        </Button>
      )}
    </div>
  )

  // ========== 两种布局 ==========

  if (editModeActive) {
    // 编辑模式：左右分栏
    return (
      <div className={unifiedStyles.u31}>
        {/* 左侧：题面面板 */}
        <div className={unifiedStyles.u32}>
          <div className={unifiedStyles.u33}>
            {renderProblemButtons(true)}
            {renderProblemInfo()}
          </div>
          <div className={unifiedStyles.u34}>
            {renderStatementSelector()}
            <div className={unifiedStyles.u35}>
              {renderStatementContent()}
            </div>
          </div>
        </div>

        {/* 右侧：编辑器面板 */}
        <div className={unifiedStyles.u32}>
          <div className={unifiedStyles.u36}>
            <span>{contest.type === 'contest' ? '比赛记录' : '训练记录'}</span>
            <span>{contest.type === 'contest' ? '比赛记录' : '思路记录'}</span>
            <div className={unifiedStyles.u37} />
            {renderSaveButton()}
            {renderSaveStatus()}
            {renderModeButtons()}
            <Button variant="ghost" onClick={() => setEditModeActive(false)} className={unifiedStyles.u38}>关闭</Button>
          </div>
          {renderEditorContent()}
          <div className={unifiedStyles.u39}>
            {renderActionButtons()}
          </div>
        </div>
      </div>
    )
  }

  // 默认模式：原有三列布局
  return (
    <div className={unifiedStyles.u40}>
      {/* 左侧：题目按钮 */}
      <div className={unifiedStyles.u41}>
        <div className={unifiedStyles.u42}>
          {renderProblemButtons(false)}
        </div>
      </div>

      {/* 中间：题面内容 */}
      <div className={unifiedStyles.u43}>
        <div className={unifiedStyles.u44}>
          {problemDetail ? (
            <>
              <div className={unifiedStyles.u45}>
                {renderProblemInfo()}
              </div>
              <div className={unifiedStyles.u46}>
                {renderStatementSelector()}
                <div className={unifiedStyles.u47}>
                  {renderStatementContent()}
                </div>
              </div>
            </>
          ) : (
            <div className={unifiedStyles.u1}>
              {problems.length > 0 ? '请选择左侧题目查看' : '暂无题目'}
            </div>
          )}
        </div>
      </div>

      {/* 右侧：操作按钮 */}
      <div className={unifiedStyles.u48}>
        <div className={unifiedStyles.u27}>
          {(trainingStatus !== 'upcoming' || contest.isAdmin) && (
            <Button variant="ghost"
              onClick={() => setEditModeActive(true)}
              className={unifiedStyles.u49}
            >
              {contest.type === 'contest' ? '比赛记录' : '写思路'}
            </Button>
          )}
          {renderActionButtons()}
        </div>
      </div>
    </div>
  )
}
