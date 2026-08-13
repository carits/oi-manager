'use client'

import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import type { TrainingInfo, ProblemListEntry } from '../types'
import styles from '../TrainingWorkspace.module.css'

const RESULT_LABEL_MAP: Record<string, string> = {
  accepted: 'Accepted', submitted: 'Submitted', queuing: 'Submitted', judging: 'Judging',
  wa: 'Wrong Answer', tle: 'Time Limit Exceeded', mle: 'Memory Limit Exceeded',
  re: 'Runtime Error', ce: 'Compilation Error', pe: 'Presentation Error',
  ole: 'Output Limit Exceeded', pending_review: 'Judging', remote_unavailable: 'Judge Error',
  judge_failed: 'Judge Error', unknown_error: 'Judge Error', submit_failed: 'Submit Failed',
}

function toExcelColumnName(index: number) {
  let result = ''
  let i = index
  while (i >= 0) {
    result = String.fromCharCode(65 + (i % 26)) + result
    i = Math.floor(i / 26) - 1
  }
  return result
}

function sourceText(problem: ProblemListEntry) {
  if (!problem.platform || !problem.platformProblemId || problem.platform === 'all') return ''
  const platform = problem.platform === 'carits'
    ? 'Carits'
    : OJ_PLATFORM_LABEL_MAP[problem.platform] || problem.platformLabel || problem.platform
  return platform && platform !== '全部平台' ? `${platform} ${problem.platformProblemId}` : ''
}

function scoreClass(score: number, max: number) {
  if (score >= max) return styles.problemStatusAccepted
  if (score > 0) return styles.problemStatusPartial
  return styles.problemStatusMuted
}

function renderStatus(problem: ProblemListEntry, training: TrainingInfo) {
  if (!problem.hasSubmitted) return null
  if (training.format === 'oi') {
    if (training.runtimeStatus !== 'finished' && !training.isAdmin) {
      return <span className={`${styles.problemStatus} ${styles.problemStatusSubmitted}`}>Submitted</span>
    }
    const score = problem.bestScore ?? 0
    const max = problem.points ?? 100
    return <span className={`${styles.problemScore} ${scoreClass(score, max)}`}>{score} / {max}</span>
  }
  if (training.format === 'ioi') {
    const status = problem.displayStatus || problem.latestResult || problem.bestResult
    if (status === 'judging' || status === 'queuing') {
      return <span className={`${styles.problemStatus} ${styles.problemStatusSubmitted}`}>Judging</span>
    }
    const score = problem.bestScore ?? 0
    const max = problem.points ?? 100
    return <span className={`${styles.problemScore} ${scoreClass(score, max)}`}>{score} / {max}</span>
  }
  const status = problem.displayStatus || (problem.hasAccepted ? 'accepted' : problem.latestResult || problem.bestResult || 'submitted')
  const label = RESULT_LABEL_MAP[status] || status
  const tone = status === 'accepted'
    ? styles.problemStatusAccepted
    : status === 'submitted' || status === 'queuing' || status === 'judging'
      ? styles.problemStatusSubmitted
      : styles.problemStatusFailed
  return <span className={`${styles.problemStatus} ${tone}`}>{label}</span>
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
  const openProblem = (id: string) => {
    onSelectProblem(id)
    onSwitchToProblemsTab()
  }
  const sourceVisible = !problemListData.some(problem => problem.problemSourceHidden || problem.problemIdentityHidden)
  const renderSource = (problem: ProblemListEntry) => {
    const text = sourceText(problem)
    if (!text) return <span className={styles.problemSource}>-</span>
    if (problem.platform === 'carits' && problem.problemTableId) {
      return <a className={styles.problemSourceLink} href={`${basePath.split('/team')[0]}/problems/${problem.problemTableId}`} target="_blank" rel="noopener noreferrer">{text}</a>
    }
    if (problem.problemUrl) {
      return <a className={styles.problemSourceLink} href={problem.problemUrl} target="_blank" rel="noopener noreferrer">{text}</a>
    }
    return <span className={styles.problemSource}>{text}</span>
  }

  return (
    <div className={styles.surface}>
      <div className={styles.scroll}>
        <table className={`${styles.table} ${styles.problemListTable} ${sourceVisible ? styles.problemListWithSource : styles.problemListWithoutSource}`}>
          <thead>
            <tr>
              <th className={styles.problemStatusColumn}>状态</th>
              <th className={styles.problemSequenceColumn}>序号</th>
              {sourceVisible && <th className={styles.problemSourceColumn}>来源</th>}
              <th>标题</th>
            </tr>
          </thead>
          <tbody>
            {problemListData.length === 0 && (
              <tr><td colSpan={sourceVisible ? 4 : 3} className={styles.empty}>暂无题目</td></tr>
            )}
            {problemListData.map(problem => {
              const title = problem.title?.trim() || problem.problemTitle?.trim()
              return (
                <tr key={problem.id}>
                  <td className={styles.problemStatusColumn}>{renderStatus(problem, training)}</td>
                  <td className={styles.problemSequenceColumn}>
                    <span className={styles.problemCode}>{toExcelColumnName(problem.orderIndex)}</span>
                  </td>
                  {sourceVisible && <td className={styles.problemSourceColumn}>{renderSource(problem)}</td>}
                  <td className={styles.problemTitleCell}>
                    <button
                      type="button"
                      className={styles.problemTitleButton}
                      onClick={() => openProblem(problem.id)}
                      title={title || '题目标题缺失'}
                    >
                      {title || '题目标题缺失'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
