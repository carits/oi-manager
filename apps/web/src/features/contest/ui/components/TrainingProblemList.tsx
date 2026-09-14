'use client'

import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { Button } from '@/components/ui/Button'
import type { TrainingInfo, ProblemListEntry } from '../../model/types'
import { trainingProblemCode, trainingProblemTitle } from '../problem-label'
import styles from '../TrainingWorkspace.module.css'

const RESULT_LABEL_MAP: Record<string, string> = {
  accepted: 'Accepted', submitted: 'Submitted', queuing: 'Submitted', judging: 'Judging',
  wa: 'Wrong Answer', tle: 'Time Limit Exceeded', mle: 'Memory Limit Exceeded',
  re: 'Runtime Error', ce: 'Compilation Error', pe: 'Presentation Error',
  ole: 'Output Limit Exceeded', pending_review: 'Judging', remote_unavailable: 'Judge Error',
  judge_failed: 'Judge Error', unknown_error: 'Judge Error', submit_failed: 'Submit Failed',
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
        <TableRoot className={`${styles.table} ${styles.problemListTable} ${sourceVisible ? styles.problemListWithSource : styles.problemListWithoutSource}`}>
          <TableHead>
            <TableRow>
              <TableHeaderCell className={styles.problemStatusColumn}>状态</TableHeaderCell>
              <TableHeaderCell className={styles.problemSequenceColumn}>序号</TableHeaderCell>
              {sourceVisible && <TableHeaderCell className={styles.problemSourceColumn}>来源</TableHeaderCell>}
              <TableHeaderCell>标题</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {problemListData.length === 0 && (
              <TableRow><TableCell colSpan={sourceVisible ? 4 : 3} className={styles.empty}>暂无题目</TableCell></TableRow>
            )}
            {problemListData.map(problem => {
              const title = trainingProblemTitle(problem)
              return (
                <TableRow key={problem.id}>
                  <TableCell className={styles.problemStatusColumn}>{renderStatus(problem, training)}</TableCell>
                  <TableCell className={styles.problemSequenceColumn}>
                    <span className={styles.problemCode}>{trainingProblemCode(problem.orderIndex)}</span>
                  </TableCell>
                  {sourceVisible && <TableCell className={styles.problemSourceColumn}>{renderSource(problem)}</TableCell>}
                  <TableCell className={styles.problemTitleCell}>
                    <Button variant="ghost"
                      type="button"
                      className={styles.problemTitleButton}
                      onClick={() => openProblem(problem.id)}
                      title={title}
                    >
                      {title}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </TableRoot>
      </div>
    </div>
  )
}
