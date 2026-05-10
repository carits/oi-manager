'use client'

import { Button } from '@/components/ui/Button'
import { JUDGE_RESULT_LABEL_MAP, LANGUAGE_LABEL_MAP } from '@/lib/judge-constants'
import type { TrainingInfo, TrainingProblem, SubmissionRow } from '../types'

const RESULT_COLORS: Record<string, { bg: string; text: string }> = {
  accepted: { bg: 'var(--success-light)', text: 'var(--success-text)' },
  queuing: { bg: 'var(--info-light)', text: 'var(--info-text)' },
  tle: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  mle: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  wa: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  re: { bg: 'var(--error-light)', text: 'var(--error-text)' },
  ce: { bg: 'var(--warning-light)', text: 'var(--text-secondary)' },
  pe: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
  ole: { bg: 'var(--warning-light)', text: 'var(--warning-text)' },
}

function getResultBadge(result: string | null, hidden?: boolean, displayResult?: string) {
  // OI 赛中非管理员：显示"已提交"
  if (hidden || displayResult === 'pending') {
    return (
      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500, background: 'var(--info-light)', color: 'var(--info-text)' }}>
        已提交
      </span>
    )
  }

  if (!result) {
    return (
      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500, background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>
        -
      </span>
    )
  }

  const label = JUDGE_RESULT_LABEL_MAP[result] || result
  const colors = RESULT_COLORS[result] || { bg: 'var(--bg-muted)', text: 'var(--text-primary)' }
  if (result === 'queuing' || result === 'judging') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500, background: colors.bg, color: colors.text }}>
        <span style={{ display: 'inline-block', width: '12px', height: '12px', border: '2px solid #e5e7eb', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: '4px', verticalAlign: 'middle' }} />
        {label}
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 500, background: colors.bg, color: colors.text }}>
      {label}
    </span>
  )
}

import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'

function getOjLabel(oj: string): string {
  if (oj === 'carits') return 'Carits平台'
  return OJ_PLATFORM_LABEL_MAP[oj] || oj
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

interface TrainingSubmissionPanelProps {
  training: TrainingInfo
  problems: TrainingProblem[]
  submissions: SubmissionRow[]
  submissionsPage: number
  submissionsTotal: number
  filterProblemId: string
  setFilterProblemId: (v: string) => void
  filterUsername: string
  setFilterUsername: (v: string) => void
  filterResult: string
  setFilterResult: (v: string) => void
  filterLanguage: string
  setFilterLanguage: (v: string) => void
  setSubmissionsPage: (v: number | ((p: number) => number)) => void
  resetFilters: () => void
  onViewSubmission: (id: number) => void
  onLanguageClick: (id: number) => void
}

export function TrainingSubmissionPanel({
  training,
  problems,
  submissions,
  submissionsPage,
  submissionsTotal,
  filterProblemId,
  setFilterProblemId,
  filterUsername,
  setFilterUsername,
  filterResult,
  setFilterResult,
  filterLanguage,
  setFilterLanguage,
  setSubmissionsPage,
  resetFilters,
  onViewSubmission,
  onLanguageClick,
}: TrainingSubmissionPanelProps) {
  // 判断是否隐藏 OI 结果（OI 赛制 + 非管理员 + 非结束状态）
  const hideOiResults = training.format === 'oi' && !training.isAdmin && training.runtimeStatus !== 'finished'

  // 判断是否基于分数的赛制（OI 或 IOI）
  const isScoreBased = training.format === 'oi' || training.format === 'ioi'

  return (
    <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
      {/* 筛选栏 */}
      <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>题号:</label>
          <select
            value={filterProblemId}
            onChange={e => { setFilterProblemId(e.target.value); setSubmissionsPage(1) }}
            style={{ padding: '0.35rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', minWidth: '80px', background: 'white' }}
          >
            <option value="">全部</option>
            {problems.map(p => <option key={p.id} value={p.id}>{toExcelColumnName(p.orderIndex)}</option>)}
          </select>
        </div>
        {training.isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>用户名:</label>
            <input
              type="text"
              value={filterUsername}
              onChange={e => { setFilterUsername(e.target.value); setSubmissionsPage(1) }}
              placeholder="输入用户名"
              style={{ padding: '0.35rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', width: '120px' }}
            />
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>结果:</label>
          <select
            value={filterResult}
            onChange={e => { setFilterResult(e.target.value); setSubmissionsPage(1) }}
            style={{ padding: '0.35rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', minWidth: '100px', background: 'white' }}
          >
            <option value="">全部</option>
            <option value="accepted">Accepted</option>
            <option value="wa">Wrong Answer</option>
            <option value="tle">Time Limit</option>
            <option value="mle">Memory Limit</option>
            <option value="re">Runtime Error</option>
            <option value="ce">Compile Error</option>
            <option value="pe">Presentation Error</option>
            <option value="ole">Output Limit</option>
            <option value="pending">Pending</option>
            <option value="judging">Judging</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>语言:</label>
          <select
            value={filterLanguage}
            onChange={e => { setFilterLanguage(e.target.value); setSubmissionsPage(1) }}
            style={{ padding: '0.35rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', minWidth: '100px', background: 'white' }}
          >
            <option value="">全部</option>
            <option value="c">C</option>
            <option value="cpp">C++</option>
            <option value="cpp14">C++14</option>
            <option value="cpp17">C++17</option>
            <option value="cpp20">C++20</option>
            <option value="java">Java</option>
            <option value="python">Python</option>
            <option value="python3">Python3</option>
            <option value="pascal">Pascal</option>
            <option value="go">Go</option>
            <option value="rust">Rust</option>
          </select>
        </div>
        <button
          onClick={resetFilters}
          style={{ padding: '0.35rem 0.75rem', background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
        >
          重置
        </button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>评测ID</th>
            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>题号</th>
            {training.isAdmin && (
              <>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>姓名</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>用户名</th>
              </>
            )}
            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>OJ</th>
            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>评测结果</th>
            {isScoreBased && <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>分数</th>}
            {!hideOiResults && (
              <>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>耗时(MS)</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>内存(MB)</th>
              </>
            )}
            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>代码长度(B)</th>
            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>语言</th>
            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>提交时间</th>
          </tr>
        </thead>
        <tbody>
          {submissions.length === 0 ? (
            <tr>
              <td colSpan={7 + (training.isAdmin ? 2 : 0) + (isScoreBased ? 1 : 0) + (hideOiResults ? 0 : 2)} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                暂无评测记录
              </td>
            </tr>
          ) : (
            submissions.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td
                  onClick={() => onViewSubmission(s.id)}
                  style={{ padding: '0.75rem 1rem', color: 'var(--primary)', fontFamily: 'monospace', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  #{s.id}
                </td>
                <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)', fontWeight: 500 }}>{toExcelColumnName(s.problemOrderIndex)}</td>
                {training.isAdmin && (
                  <>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{s.userName}</td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{s.username}</td>
                  </>
                )}
                <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{getOjLabel(s.oj)}</td>
                <td style={{ padding: '0.75rem 1rem' }}>{getResultBadge(s.result, s.hidden, s.displayResult)}</td>
                {isScoreBased && <td style={{ padding: '0.75rem 1rem', textAlign: 'center', color: 'var(--text-primary)' }}>{s.hidden ? '-' : (s.score ?? '-')}</td>}
                {!hideOiResults && (
                  <>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{s.timeUsed ?? '-'}</td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{s.memoryUsed != null ? (s.memoryUsed / 1024).toFixed(2) : '-'}</td>
                  </>
                )}
                <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)' }}>{s.codeLength ?? '-'}</td>
                <td
                  onClick={() => onLanguageClick(s.id)}
                  style={{ padding: '0.75rem 1rem', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  {LANGUAGE_LABEL_MAP[s.language] || s.language}
                </td>
                <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {new Date(s.createdAt).toLocaleString('zh-CN')}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {submissionsTotal > 50 && (
        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
          <Button variant="secondary" disabled={submissionsPage <= 1} onClick={() => setSubmissionsPage(p => p - 1)}>上一页</Button>
          <span style={{ lineHeight: '2.2rem', fontSize: '0.85rem', color: 'var(--gray-500)' }}>
            {submissionsPage} / {Math.ceil(submissionsTotal / 50)}
          </span>
          <Button variant="secondary" disabled={submissionsPage >= Math.ceil(submissionsTotal / 50)} onClick={() => setSubmissionsPage(p => p + 1)}>下一页</Button>
        </div>
      )}
    </div>
  )
}
