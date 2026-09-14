'use client'

import { Button } from '@/components/ui/Button'
import collisionStyles from './TrainingSubmissionPanel.collision.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { Input, Select } from '@/components/ui/FormControls'
import { JUDGE_RESULT_LABEL_MAP, JUDGE_RESULT_OPTIONS, LANGUAGE_LABEL_MAP, LANGUAGE_OPTIONS } from '@/lib/judge-constants'
import type { TrainingInfo, TrainingProblem, SubmissionRow } from '../../model/types'
import { LoadError } from '@/components/ui/LoadError'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { UserIdentityLink } from '@/components/profile/UserIdentityLink'
import styles from '../TrainingWorkspace.module.css'

const RESULT_TONES: Record<string, 'accepted' | 'info' | 'warning' | 'error' | 'compile'> = { accepted: 'accepted', queuing: 'info', judging: 'info', tle: 'warning', mle: 'warning', wa: 'error', re: 'error', ce: 'compile', pe: 'warning', ole: 'warning' }
function toExcelColumnName(index: number) { let result = ''; let i = index; while (i >= 0) { result = String.fromCharCode(65 + (i % 26)) + result; i = Math.floor(i / 26) - 1 } return result }
function resultBadge(result: string | null, hidden?: boolean, display?: string) { if (hidden || display === 'pending') return <span className={styles.submissionHidden}>已提交</span>; if (!result) return <span className={[(`${styles.result} ${styles.muted}`), collisionStyles.u1].filter(Boolean).join(' ')} >-</span>; const tone = RESULT_TONES[result] || 'default'; return <span className={`${styles.result} ${styles[`resultTone_${tone}`]}`}>{JUDGE_RESULT_LABEL_MAP[result] || result}</span> }

interface TrainingSubmissionPanelProps { training: TrainingInfo; problems: TrainingProblem[]; submissions: SubmissionRow[]; submissionsPage: number; submissionsTotal: number; filterProblemId: string; setFilterProblemId: (v: string) => void; filterUsername: string; setFilterUsername: (v: string) => void; filterResult: string; setFilterResult: (v: string) => void; filterLanguage: string; setFilterLanguage: (v: string) => void; setSubmissionsPage: (v: number | ((p: number) => number)) => void; resetFilters: () => void; onViewSubmission: (id: number) => void; onLanguageClick: (id: number) => void; loading?: boolean; error?: string | null; onRetry?: () => void }
export function TrainingSubmissionPanel(props: TrainingSubmissionPanelProps) {
  const { training, problems, submissions, submissionsPage, submissionsTotal, filterProblemId, setFilterProblemId, filterUsername, setFilterUsername, filterResult, setFilterResult, filterLanguage, setFilterLanguage, setSubmissionsPage, resetFilters, onViewSubmission, onLanguageClick, loading, error, onRetry } = props
  const hideOiResults = training.format === 'oi' && !training.isAdmin && training.runtimeStatus !== 'finished'; const hideProblemSource = !training.isAdmin && !training.problemIdVisible && training.runtimeStatus !== 'finished'; const scoreBased = training.format === 'oi' || training.format === 'ioi'; const pages = Math.ceil(submissionsTotal / 50)
  const change = (setter: (v: string) => void, value: string) => { setter(value); setSubmissionsPage(1) }
  const filterGridClass = training.isAdmin
    ? styles.submissionFilterGridAdmin
    : hideProblemSource
      ? styles.submissionFilterGridHidden
      : styles.submissionFilterGridParticipant

  return <div className={styles.surface}><div className={styles.submissionFilterPanel} role="search" aria-label="比赛评测记录筛选"><div className={`${styles.submissionFilterGrid} ${filterGridClass}`}>
    {!hideProblemSource && <label className={styles.submissionFilterField}><span>题目</span><Select className={styles.submissionFilterControl} aria-label="题目" value={filterProblemId} onChange={e => change(setFilterProblemId, e.target.value)}><option value="">全部题目</option>{problems.map(p => <option key={p.id} value={p.id}>{toExcelColumnName(p.orderIndex ?? 0)}</option>)}</Select></label>}
    {training.isAdmin && <label className={styles.submissionFilterField}><span>用户名</span><Input className={styles.submissionFilterControl} aria-label="用户名" value={filterUsername} onChange={e => change(setFilterUsername, e.target.value)} placeholder="搜索用户名" /></label>}
    <label className={styles.submissionFilterField}><span>评测结果</span><Select className={styles.submissionFilterControl} aria-label="评测结果" value={filterResult} onChange={e => change(setFilterResult, e.target.value)}>{JUDGE_RESULT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.value ? option.label : '全部结果'}</option>)}</Select></label>
    <label className={styles.submissionFilterField}><span>语言</span><Select className={styles.submissionFilterControl} aria-label="语言" value={filterLanguage} onChange={e => change(setFilterLanguage, e.target.value)}>{LANGUAGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.value ? option.label : '全部语言'}</option>)}</Select></label>
    <div className={styles.submissionFilterActions}><Button variant="secondary" onClick={resetFilters}>重置</Button></div>
  </div></div>
    {error && <LoadError compact message={error} onRetry={onRetry || (() => undefined)} />}{loading && submissions.length === 0 ? <SkeletonRegion rows={6} label="评测记录正在准备" /> : <div className={styles.scroll}><TableRoot className={`${styles.table} ${loading ? styles.tableLoading : ''}`}><TableHead><TableRow><TableHeaderCell>评测 ID</TableHeaderCell>{!hideProblemSource && <TableHeaderCell>序号</TableHeaderCell>}{training.isAdmin && <><TableHeaderCell>姓名</TableHeaderCell><TableHeaderCell>用户名</TableHeaderCell></>}<TableHeaderCell>{hideOiResults ? '提交状态' : '评测结果'}</TableHeaderCell>{scoreBased && <TableHeaderCell className={styles.center}>分数</TableHeaderCell>}{!hideOiResults && <><TableHeaderCell>耗时 (MS)</TableHeaderCell><TableHeaderCell>内存 (MB)</TableHeaderCell></>}<TableHeaderCell>代码长度 (B)</TableHeaderCell><TableHeaderCell>语言</TableHeaderCell><TableHeaderCell>提交时间</TableHeaderCell></TableRow></TableHead><TableBody>
      {submissions.length === 0 ? <TableRow><TableCell colSpan={training.isAdmin ? (hideProblemSource ? 10 : 11) : (hideProblemSource ? 8 : 9)} className={styles.empty}>暂无评测记录</TableCell></TableRow> : submissions.map(s => <TableRow key={s.id}><TableCell><Button variant="ghost" type="button" className={styles.titleButton} onClick={() => onViewSubmission(s.id)}>#{s.id}</Button></TableCell>{!hideProblemSource && <TableCell><span className={styles.problemCode}>{s.problemOrderIndex == null ? '-' : toExcelColumnName(s.problemOrderIndex)}</span></TableCell>}{training.isAdmin && <><TableCell><UserIdentityLink id={s.userId} userType={s.userType} name={s.userName} username={s.username} /></TableCell><TableCell className={styles.muted}><UserIdentityLink id={s.userId} userType={s.userType} username={s.username} /></TableCell></>}<TableCell>{resultBadge(s.result, s.hidden, s.displayResult)}</TableCell>{scoreBased && <TableCell className={`${styles.center} ${styles.numeric}`}>{s.hidden ? '-' : s.score ?? '-'}</TableCell>}{!hideOiResults && <><TableCell className={styles.numeric}>{s.timeUsed ?? '-'}</TableCell><TableCell className={styles.numeric}>{s.memoryUsed != null ? (s.memoryUsed / 1024).toFixed(2) : '-'}</TableCell></>}<TableCell className={styles.numeric}>{s.codeLength ?? '-'}</TableCell><TableCell><Button variant="ghost" type="button" className={styles.titleButton} onClick={() => onLanguageClick(s.id)}>{LANGUAGE_LABEL_MAP[s.language] || s.language}</Button></TableCell><TableCell className={`${styles.muted} ${styles.numeric}`}>{new Date(s.createdAt).toLocaleString('zh-CN')}</TableCell></TableRow>)}
    </TableBody></TableRoot></div>}
    {submissionsTotal > 50 && <div className={styles.pager}><Button variant="secondary" disabled={submissionsPage <= 1} onClick={() => setSubmissionsPage(p => p - 1)}>上一页</Button><span className={styles.muted}>{submissionsPage} / {pages}</span><Button variant="secondary" disabled={submissionsPage >= pages} onClick={() => setSubmissionsPage(p => p + 1)}>下一页</Button></div>}
  </div>
}
