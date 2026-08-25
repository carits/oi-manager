'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react'
import apiClient from '@/lib/apiClient'
import { DetailDialog } from '@/components/ui/Dialogs'
import { Button } from '@/components/ui/Button'
import { LoadError } from '@/components/ui/LoadError'
import { JUDGE_RESULT_LABEL_MAP, LANGUAGE_LABEL_MAP } from '@/lib/judge-constants'
import type { TrainingInfo } from '../types'
import styles from './TrainingRankingSubmissionsModal.module.css'

interface RankingSubmission {
  id: number
  result: string | null
  displayResult?: string
  hidden?: boolean
  score: number | null
  timeUsed: number | null
  memoryUsed: number | null
  codeLength: number
  language: string
  createdAt: string
}

interface TrainingRankingSubmissionsModalProps {
  isOpen: boolean
  onClose: () => void
  trainingId: string
  training: TrainingInfo
  userId: string
  userName?: string
  username?: string
  trainingProblemId: string
  problemAlias: string
  onViewSubmission: (id: number) => void
}

const RESULT_COLORS: Record<string, string> = {
  accepted: styles.accepted,
  queuing: styles.pending,
  judging: styles.pending,
  wa: styles.failed,
  tle: styles.warning,
  mle: styles.warning,
  ole: styles.warning,
  re: styles.failed,
  ce: styles.warning,
}

export function TrainingRankingSubmissionsModal({
  isOpen, onClose, trainingId, training, userId, userName, username, trainingProblemId, problemAlias, onViewSubmission,
}: TrainingRankingSubmissionsModalProps) {
  const [submissions, setSubmissions] = useState<RankingSubmission[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scoreBased = training.format === 'oi' || training.format === 'ioi'
  const displayName = userName && username && userName !== username ? `${userName}（${username}）` : username || userName || '参赛者'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '50', userId, problemId: trainingProblemId })
      const data = await apiClient.query<{ submissions: RankingSubmission[] }>(`/api/trainings/${trainingId}/submissions?${params.toString()}`)
      setSubmissions(data.submissions)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '提交记录获取失败')
    } finally {
      setLoading(false)
    }
  }, [trainingId, userId, trainingProblemId])

  useEffect(() => {
    if (isOpen) void load()
  }, [isOpen, load])

  const resultLabel = (submission: RankingSubmission) => {
    if (submission.hidden || submission.displayResult === 'pending') return '已提交'
    return JUDGE_RESULT_LABEL_MAP[submission.result || ''] || submission.result || '待处理'
  }

  return <DetailDialog isOpen={isOpen} onClose={onClose} title={`${displayName} 在 ${problemAlias} 题的提交记录`} size="xl" footer={<div className={styles.footer}><Button variant="secondary" icon={<RefreshCw size={15} />} onClick={() => void load()} disabled={loading}>刷新</Button><Button variant="text" onClick={onClose}>关闭</Button></div>}>
    <div className={styles.content}>
      <div className={styles.context}><strong>{training.title}</strong><span>题目 {problemAlias}</span><span>共 {submissions.length} 条</span></div>
      {error && <LoadError compact message={error} onRetry={() => void load()} />}
      {loading && submissions.length === 0 ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={18} />正在加载提交记录…</div> : submissions.length === 0 ? <div className={styles.empty}>该用户尚未提交这道题</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>提交 ID</th><th>评测结果</th>{scoreBased && <th>分数</th>}<th>耗时</th><th>内存</th><th>代码长度</th><th>语言</th><th>提交时间</th></tr></thead><tbody>{submissions.map(submission => <tr key={submission.id} className={styles.row} onClick={() => onViewSubmission(submission.id)}><td><Button variant="ghost" type="button" className={styles.link} onClick={event => { event.stopPropagation(); onViewSubmission(submission.id) }}>#{submission.id}<ExternalLink size={13} /></Button></td><td><span className={`${styles.result} ${RESULT_COLORS[submission.result || ''] || styles.neutral}`}>{resultLabel(submission)}</span></td>{scoreBased && <td className={styles.numeric}>{submission.hidden ? '-' : submission.score ?? '-'}</td>}<td className={styles.numeric}>{submission.timeUsed == null ? '-' : `${submission.timeUsed} ms`}</td><td className={styles.numeric}>{submission.memoryUsed == null ? '-' : `${(submission.memoryUsed / 1024).toFixed(2)} MB`}</td><td className={styles.numeric}>{submission.codeLength} B</td><td>{LANGUAGE_LABEL_MAP[submission.language] || submission.language}</td><td className={styles.time}>{new Date(submission.createdAt).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div>}
    </div>
  </DetailDialog>
}
