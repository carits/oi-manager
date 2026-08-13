'use client'

import { ArrowRight } from 'lucide-react'
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
  while (i >= 0) { result = String.fromCharCode(65 + (i % 26)) + result; i = Math.floor(i / 26) - 1 }
  return result
}

function sourceText(problem: ProblemListEntry) {
  const platform = problem.platform === 'carits' ? 'Carits' : problem.platformLabel || OJ_PLATFORM_LABEL_MAP[problem.platform || ''] || problem.platform || ''
  return [platform, problem.platformProblemId].filter(Boolean).join(' ')
}

function scoreClass(score: number, max: number) {
  if (score >= max) return styles.problemStatusAccepted
  if (score > 0) return styles.problemStatusPartial
  return styles.problemStatusMuted
}

function renderStatus(problem: ProblemListEntry, training: TrainingInfo) {
  if (!problem.hasSubmitted) return null
  if (training.format === 'oi') {
    if (training.runtimeStatus !== 'finished' && !training.isAdmin) return <span className={`${styles.problemStatus} ${styles.problemStatusSubmitted}`}>Submitted</span>
    const score = problem.bestScore ?? 0; const max = problem.points ?? 100
    return <span className={`${styles.problemScore} ${scoreClass(score, max)}`}>{score} / {max}</span>
  }
  if (training.format === 'ioi') {
    const status = problem.displayStatus || problem.latestResult || problem.bestResult
    if (status === 'judging' || status === 'queuing') return <span className={`${styles.problemStatus} ${styles.problemStatusSubmitted}`}>Judging</span>
    const score = problem.bestScore ?? 0; const max = problem.points ?? 100
    return <span className={`${styles.problemScore} ${scoreClass(score, max)}`}>{score} / {max}</span>
  }
  const status = problem.displayStatus || (problem.hasAccepted ? 'accepted' : problem.latestResult || problem.bestResult || 'submitted')
  const label = RESULT_LABEL_MAP[status] || status
  const tone = status === 'accepted' ? styles.problemStatusAccepted : status === 'submitted' || status === 'queuing' || status === 'judging' ? styles.problemStatusSubmitted : styles.problemStatusFailed
  return <span className={`${styles.problemStatus} ${tone}`}>{label}</span>
}

interface TrainingProblemListProps {
  problemListData: ProblemListEntry[]; training: TrainingInfo; basePath: string
  onSelectProblem: (id: string) => void; onSwitchToProblemsTab: () => void
}

export function TrainingProblemList({ problemListData, training, basePath, onSelectProblem, onSwitchToProblemsTab }: TrainingProblemListProps) {
  const openProblem = (id: string) => { onSelectProblem(id); onSwitchToProblemsTab() }
  const renderSource = (problem: ProblemListEntry) => {
    if (problem.problemSourceHidden || problem.problemIdentityHidden) return null
    const text = sourceText(problem)
    if (!text) return null
    if (problem.platform === 'carits' && problem.problemTableId) return <a className={styles.problemSourceLink} href={`${basePath.split('/team')[0]}/problems/${problem.problemTableId}`} target="_blank" rel="noopener noreferrer">{text}</a>
    if (problem.problemUrl) return <a className={styles.problemSourceLink} href={problem.problemUrl} target="_blank" rel="noopener noreferrer">{text}</a>
    return <span className={styles.problemSource}>{text}</span>
  }
  return <div className={styles.surface}><div className={styles.scroll}><table className={`${styles.table} ${styles.problemListTable}`}><thead><tr><th>题目</th><th className={styles.problemPointsColumn}>分值</th><th className={styles.problemStatusColumn}>我的状态</th><th className={styles.problemActionColumn}><span className="sr-only">操作</span></th></tr></thead><tbody>
    {problemListData.length === 0 && <tr><td colSpan={4} className={styles.empty}>暂无题目</td></tr>}
    {problemListData.map(problem => {
      const title = problem.alias || problem.title || '未命名题目'
      return <tr key={problem.id}><td className={styles.problemIdentityCell}><button type="button" className={styles.problemIdentityButton} onClick={() => openProblem(problem.id)} title={title}><span className={styles.problemCode}>{toExcelColumnName(problem.orderIndex)}</span><span className={styles.problemIdentityText}><span className={styles.problemTitle}>{title}</span>{renderSource(problem)}</span></button></td><td className={`${styles.problemPointsColumn} ${styles.numeric}`}>{problem.points == null ? '' : problem.points}</td><td className={styles.problemStatusColumn}>{renderStatus(problem, training)}</td><td className={styles.problemActionColumn}><button type="button" className={styles.problemOpenButton} title="进入题面" aria-label={`进入题目 ${toExcelColumnName(problem.orderIndex)}`} onClick={() => openProblem(problem.id)}><ArrowRight size={17} aria-hidden="true" /></button></td></tr>
    })}
  </tbody></table></div></div>
}
