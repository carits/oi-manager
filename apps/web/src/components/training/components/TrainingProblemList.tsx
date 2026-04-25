'use client'

import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import type { TrainingInfo, ProblemListEntry } from '../types'

const RESULT_SHORT_MAP: Record<string, string> = {
  accepted: 'AC',
  wa: 'WA', tle: 'TLE', mle: 'MLE', re: 'RE',
  ce: 'CE', pe: 'PE', ole: 'OLE',
  pending_review: 'Pending',
  queuing: 'Queuing', judging: 'Judging',
  remote_unavailable: 'Err', judge_failed: 'Err', unknown_error: 'Err', submit_failed: 'Err',
}

function getScoreColor(score: number, max: number): string {
  const ratio = max > 0 ? score / max : 0
  if (ratio >= 1) return 'var(--success)'
  if (ratio >= 0.5) return 'var(--warning)'
  return 'var(--error)'
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

interface TrainingProblemListProps {
  problemListData: ProblemListEntry[]
  training: TrainingInfo
  basePath: string
  onSelectProblem: (id: string) => void
  onSwitchToProblemsTab: () => void
}

export function TrainingProblemList({
  problemListData,
  training,
  basePath,
  onSelectProblem,
  onSwitchToProblemsTab,
}: TrainingProblemListProps) {
  const trainingFinished = training.status === 'finished' || new Date() > new Date(training.endTime)
  const hideSourceColumn = !training.problemIdVisible && !trainingFinished && !training.isAdmin

  return (
    <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', width: '80px' }}>状态</th>
            <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', width: '60px' }}>题号</th>
            {!hideSourceColumn && <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', width: '180px' }}>来源</th>}
            <th style={{ padding: '0.6rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)' }}>标题</th>
          </tr>
        </thead>
        <tbody>
          {problemListData.length === 0 && (
            <tr>
              <td colSpan={hideSourceColumn ? 3 : 4} style={{ padding: '3rem', textAlign: 'center', color: 'var(--gray-400)' }}>暂无题目</td>
            </tr>
          )}
          {problemListData.map(p => {
            const isAccepted = p.bestResult === 'accepted'
            const hasSubmission = p.bestResult != null
            const maxPoints = p.points ?? 100

            return (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                {/* 状态列 */}
                <td style={{ padding: '0.6rem 1rem' }}>
                  {training.format === 'icpc' ? (
                    hasSubmission ? (
                      <span style={{
                        display: 'inline-block',
                        padding: '1px 6px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        fontFamily: 'monospace',
                        background: isAccepted ? 'var(--success-light)' : 'var(--error-light)',
                        color: isAccepted ? 'var(--success-text)' : 'var(--error-text)',
                      }}>
                        {RESULT_SHORT_MAP[p.bestResult!] || p.bestResult}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>-</span>
                    )
                  ) : (
                    hasSubmission ? (
                      <span style={{ fontWeight: 600, color: getScoreColor(p.bestScore ?? 0, maxPoints) }}>
                        {isAccepted ? '✓ ' : ''}{p.bestScore}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>-</span>
                    )
                  )}
                </td>

                {/* 序号列 */}
                <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', fontWeight: 500 }}>
                  {toExcelColumnName(p.orderIndex)}
                </td>

                {/* 来源列 */}
                {!hideSourceColumn && (
                <td style={{ padding: '0.6rem 1rem' }}>
                  {(() => {
                    if (p.platform === 'carits') {
                      return (
                        <a href={`${basePath.split('/team')[0]}/problems/${p.problemTableId}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
                          Carits {p.platformProblemId}
                        </a>
                      )
                    } else if (p.platform && p.problemUrl) {
                      return (
                        <a href={p.problemUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
                          {p.platformLabel} {p.platformProblemId}
                        </a>
                      )
                    } else if (p.platform) {
                      return <span style={{ color: 'var(--text-secondary)' }}>{p.platformLabel} {p.platformProblemId}</span>
                    } else {
                      return <span style={{ color: 'var(--gray-400)' }}>-</span>
                    }
                  })()}
                </td>
                )}

                {/* 标题列 */}
                <td style={{ padding: '0.6rem 1rem' }}>
                  <span
                    onClick={() => {
                      onSelectProblem(p.id)
                      onSwitchToProblemsTab()
                    }}
                    style={{ color: 'var(--primary)', cursor: 'pointer', textDecoration: 'none' }}
                  >
                    {p.alias || p.title || '未命名'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
