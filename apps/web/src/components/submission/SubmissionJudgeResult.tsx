'use client'

import { JUDGE_RESULT_LABEL_MAP } from '@/lib/judge-constants'
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
    <section aria-label="评测详情" style={{ marginBottom: '1.5rem', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.8rem 1rem', background: 'var(--bg-muted)' }}>
        {judgeMode === 'oi' && score != null && (
          <strong style={{ fontSize: '1.1rem', color: score >= 100 ? 'var(--success-text)' : 'var(--warning-text)' }}>{score} / 100</strong>
        )}
        <strong>{verdictLabel(result)}</strong>
        {judgeMode === 'acm' && failedIndex >= 0 && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>失败测试点 #{failedIndex + 1}</span>}
      </div>
      {rows.length > 0 && <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '560px', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={headerCell}>#</th>
              <th style={headerCell}>状态</th>
              {judgeMode === 'oi' && <th style={{ ...headerCell, textAlign: 'right' }}>得分</th>}
              <th style={{ ...headerCell, textAlign: 'right' }}>用时</th>
              <th style={{ ...headerCell, textAlign: 'right' }}>内存</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              if (row.kind === 'subtask') {
                return (
                  <tr key={`subtask-${row.subtask.id}-${rowIndex}`} style={{ background: 'var(--bg-muted)' }}>
                    <td colSpan={judgeMode === 'oi' ? 5 : 4} style={{ padding: '0.6rem 0.75rem', fontWeight: 700 }}>
                      Subtask {row.subtask.id}
                      <span style={{ marginLeft: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>{row.subtask.cases.length} 个测试点 · {row.subtask.type}</span>
                      <span style={{ marginLeft: '0.75rem', color: 'var(--primary)' }}>{row.subtask.score} 分</span>
                    </td>
                  </tr>
                )
              }
              const tone = CASE_TONE[row.testCase.result] || { mark: '✕', color: 'var(--error-text)' }
              return (
                <tr key={`case-${row.index}-${rowIndex}`} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={bodyCell}>{row.index + 1}</td>
                  <td style={bodyCell}>
                    <span style={{ color: tone.color, fontWeight: 700 }}>{tone.mark}</span>
                    <span style={{ marginLeft: '0.4rem' }}>{row.testCase.result}</span>
                    {row.testCase.message && row.testCase.message !== row.testCase.result && (
                      <div style={{ marginTop: '0.2rem', color: 'var(--text-muted)', fontSize: '0.72rem', whiteSpace: 'pre-wrap' }}>{row.testCase.message}</div>
                    )}
                  </td>
                  {judgeMode === 'oi' && <td style={{ ...bodyCell, textAlign: 'right', fontWeight: 600 }}>{row.testCase.score ?? '-'}</td>}
                  <td style={{ ...bodyCell, textAlign: 'right' }}>{row.testCase.time != null ? `${row.testCase.time} ms` : '-'}</td>
                  <td style={{ ...bodyCell, textAlign: 'right' }}>{formatJudgeMemory(row.testCase.memory)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
