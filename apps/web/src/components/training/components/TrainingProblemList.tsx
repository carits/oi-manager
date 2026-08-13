'use client'

import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import type { TrainingInfo, ProblemListEntry } from '../types'
import styles from '../TrainingWorkspace.module.css'

const RESULT_SHORT_MAP: Record<string, string> = { accepted: 'AC', wa: 'WA', tle: 'TLE', mle: 'MLE', re: 'RE', ce: 'CE', pe: 'PE', ole: 'OLE', pending_review: 'Pending', queuing: 'Queuing', judging: 'Judging', remote_unavailable: 'Err', judge_failed: 'Err', unknown_error: 'Err', submit_failed: 'Err' }
function toExcelColumnName(index: number) { let result = ''; let i = index; while (i >= 0) { result = String.fromCharCode(65 + (i % 26)) + result; i = Math.floor(i / 26) - 1 } return result }
function scoreColor(score: number, max: number) { if (score >= max) return 'var(--success-text)'; if (score > 0) return 'var(--warning-text)'; return 'var(--text-muted)' }

interface TrainingProblemListProps { problemListData: ProblemListEntry[]; training: TrainingInfo; basePath: string; onSelectProblem: (id: string) => void; onSwitchToProblemsTab: () => void }
export function TrainingProblemList({ problemListData, training, basePath, onSelectProblem, onSwitchToProblemsTab }: TrainingProblemListProps) {
  const runtimeFinished = training.runtimeStatus === 'finished' || training.status === 'finished' || new Date() > new Date(training.endTime)
  const hideOiResults = training.format === 'oi' && !training.isAdmin && !runtimeFinished
  const hideProblemIdentity = !training.problemIdVisible && !runtimeFinished && !training.isAdmin
  const source = (p: ProblemListEntry) => {
    const text = p.platform === 'carits' ? `Carits ${p.platformProblemId}` : `${p.platformLabel || OJ_PLATFORM_LABEL_MAP[p.platform || ''] || p.platform || ''} ${p.platformProblemId || ''}`.trim()
    if (p.platform === 'carits') return <a className={styles.sourceLink} href={`${basePath.split('/team')[0]}/problems/${p.problemTableId}`} target="_blank" rel="noopener noreferrer">{text}</a>
    if (p.platform && p.problemUrl) return <a className={styles.sourceLink} href={p.problemUrl} target="_blank" rel="noopener noreferrer">{text}</a>
    return text ? <span className={styles.source}>{text}</span> : <span className={styles.muted}>-</span>
  }
  return <div className={styles.surface}><div className={styles.scroll}><table className={styles.table}><thead><tr><th>状态</th>{hideProblemIdentity ? <th>比赛题目</th> : <><th>题号</th><th>来源</th><th>标题</th></>}</tr></thead><tbody>
    {problemListData.length === 0 && <tr><td colSpan={hideProblemIdentity ? 2 : 4} className={styles.empty}>暂无题目</td></tr>}
    {problemListData.map(p => { const accepted = p.bestResult === 'accepted'; const submitted = p.hasSubmitted || p.bestResult != null; const max = p.points ?? 100; const status = hideOiResults ? (p.hasSubmitted ? <span className={styles.result} style={{ background: 'var(--info-light)', color: 'var(--info-text)' }}>已提交</span> : <span className={styles.muted}>-</span>) : training.format === 'icpc' ? (submitted ? <span className={styles.result} style={{ background: accepted ? 'var(--success-light)' : 'var(--error-light)', color: accepted ? 'var(--success-text)' : 'var(--error-text)' }}>{RESULT_SHORT_MAP[p.bestResult || ''] || p.bestResult}</span> : <span className={styles.muted}>-</span>) : (submitted ? <strong style={{ color: scoreColor(p.bestScore ?? 0, max) }}>{accepted ? '✓ ' : ''}{p.bestScore}</strong> : <span className={styles.muted}>-</span>)
      return <tr key={p.id}><td>{status}</td>{hideProblemIdentity ? <td><button type="button" className={styles.titleButton} onClick={() => { onSelectProblem(p.id); onSwitchToProblemsTab() }}>查看题目</button></td> : <><td><span className={styles.problemCode}>{toExcelColumnName(p.orderIndex)}</span></td><td>{source(p)}</td><td><button type="button" className={styles.titleButton} onClick={() => { onSelectProblem(p.id); onSwitchToProblemsTab() }}>{p.alias || p.title || '未命名'}</button></td></>}</tr> })}
  </tbody></table></div></div>
}
