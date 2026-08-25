'use client'

import { JUDGE_RESULT_LABEL_MAP } from '@/lib/judge-constants'
import unifiedStyles from './SubmissionJudgeResult.unified.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import type { CSSProperties } from 'react'
import {
  buildJudgeResultRows,
  firstFailedCaseIndex,
  formatJudgeMemory,
  type JudgeCaseResult,
  type JudgeSubtaskResult,
} from './judge-result'

interface SubmissionJudgeResultProps {
  judgeMode?: 'acm' | 'oi'
  result: string | null
  score?: number | null
  cases?: JudgeCaseResult[] | null
  subtasks?: JudgeSubtaskResult[] | null
  hidden?: boolean
}

const CASE_TONE: Record<string, { mark: string; color: string }> = {
  Accepted: { mark: '✓', color: 'var(--success-text)' },
  accepted: { mark: '✓', color: 'var(--success-text)' },
  Skipped: { mark: '–', color: 'var(--text-muted)' },
  skipped: { mark: '–', color: 'var(--text-muted)' },
}

function verdictLabel(result: string | null): string {
  return result ? JUDGE_RESULT_LABEL_MAP[result] || result : '-'
}

export function SubmissionJudgeResult({
  judgeMode = 'acm',
  result,
  score,
  cases,
  subtasks,
  hidden,
}: SubmissionJudgeResultProps) {
  if (hidden) return null
  const rows = buildJudgeResultRows(judgeMode, cases, subtasks)
  const failedIndex = firstFailedCaseIndex(cases)

  return (
    <section aria-label="评测详情" className={unifiedStyles.u1}>
      <div className={unifiedStyles.u2}>
        {judgeMode === 'oi' && score != null && (
          <strong style={{ fontSize: '1.1rem', color: score >= 100 ? 'var(--success-text)' : 'var(--warning-text)' }}>{score} / 100</strong>
        )}
        <strong>{verdictLabel(result)}</strong>
        {judgeMode === 'acm' && failedIndex >= 0 && <span className={unifiedStyles.u3}>失败测试点 #{failedIndex + 1}</span>}
      </div>
      {rows.length > 0 && <div className={unifiedStyles.u4}>
        <TableRoot className={unifiedStyles.u5}>
          <TableHead>
            <TableRow className={unifiedStyles.u6}>
              <TableHeaderCell style={headerCell}>#</TableHeaderCell>
              <TableHeaderCell style={headerCell}>状态</TableHeaderCell>
              {judgeMode === 'oi' && <TableHeaderCell style={{ ...headerCell, textAlign: 'right' }}>得分</TableHeaderCell>}
              <TableHeaderCell style={{ ...headerCell, textAlign: 'right' }}>用时</TableHeaderCell>
              <TableHeaderCell style={{ ...headerCell, textAlign: 'right' }}>内存</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, rowIndex) => {
              if (row.kind === 'subtask') {
                return (
                  <TableRow key={`subtask-${row.subtask.id}-${rowIndex}`} className={unifiedStyles.u7}>
                    <TableCell colSpan={judgeMode === 'oi' ? 5 : 4} className={unifiedStyles.u8}>
                      Subtask {row.subtask.id}
                      <span className={unifiedStyles.u9}>{row.subtask.cases.length} 个测试点 · {row.subtask.type}</span>
                      <span className={unifiedStyles.u10}>{row.subtask.score} 分</span>
                    </TableCell>
                  </TableRow>
                )
              }
              const tone = CASE_TONE[row.testCase.result] || { mark: '✕', color: 'var(--error-text)' }
              return (
                <TableRow key={`case-${row.index}-${rowIndex}`} className={unifiedStyles.u11}>
                  <TableCell style={bodyCell}>{row.index + 1}</TableCell>
                  <TableCell style={bodyCell}>
                    <span style={{ color: tone.color, fontWeight: 700 }}>{tone.mark}</span>
                    <span className={unifiedStyles.u12}>{row.testCase.result}</span>
                    {row.testCase.message && row.testCase.message !== row.testCase.result && (
                      <div className={unifiedStyles.u13}>{row.testCase.message}</div>
                    )}
                  </TableCell>
                  {judgeMode === 'oi' && <TableCell style={{ ...bodyCell, textAlign: 'right', fontWeight: 600 }}>{row.testCase.score ?? '-'}</TableCell>}
                  <TableCell style={{ ...bodyCell, textAlign: 'right' }}>{row.testCase.time != null ? `${row.testCase.time} ms` : '-'}</TableCell>
                  <TableCell style={{ ...bodyCell, textAlign: 'right' }}>{formatJudgeMemory(row.testCase.memory)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </TableRoot>
      </div>}
    </section>
  )
}

const headerCell: CSSProperties = {
  padding: '0.55rem 0.75rem',
  color: 'var(--text-secondary)',
  fontWeight: 600,
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

const bodyCell: CSSProperties = {
  padding: '0.55rem 0.75rem',
  verticalAlign: 'top',
}
