'use client'

import { useEffect, useMemo, useState } from 'react'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { AlertTriangle, Check, ClipboardList, ListChecks, LoaderCircle, RotateCcw, UserRound } from 'lucide-react'
import apiClient from '@/lib/apiClient'
import { FormDialog } from '@/components/ui/Dialogs'
import { Button } from '@/components/ui/Button'
import type { TrainingProblem } from '../../model/types'
import styles from './TrainingRejudgeModal.module.css'

type ScopeType = 'all' | 'problem' | 'user_problem'

export interface RejudgeUser {
  id: string
  username: string
  displayName?: string
}

interface TrainingRejudgeModalProps {
  isOpen: boolean
  onClose: () => void
  trainingTitle: string
  trainingId: string
  problems: TrainingProblem[]
  users: RejudgeUser[]
  usersLoading?: boolean
  onLoadUsers: () => Promise<void>
  onSuccess: () => Promise<void>
}

export function TrainingRejudgeModal({
  isOpen, onClose, trainingTitle, trainingId, problems, users, usersLoading = false, onLoadUsers, onSuccess,
}: TrainingRejudgeModalProps) {
  const [scope, setScope] = useState<ScopeType>('all')
  const [problemId, setProblemId] = useState('')
  const [userId, setUserId] = useState('')
  const [preview, setPreview] = useState<{ matchedCount: number; inProgressCount: number } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const ready = scope === 'all' || (Boolean(problemId) && (scope !== 'user_problem' || Boolean(userId)))
  const selectedProblem = problems.find(problem => problem.id === problemId)
  const selectedUser = users.find(user => user.id === userId)
  const selectionHint = scope === 'all' ? '' : !problemId ? '请选择题目后继续' : scope === 'user_problem' && !userId ? '请选择用户后继续' : ''

  useEffect(() => {
    if (!isOpen) return
    setMessage(null)
    if (scope === 'user_problem') void onLoadUsers()
  }, [isOpen, onLoadUsers, scope])

  useEffect(() => {
    if (!isOpen || !ready) {
      setPreview(null)
      setPreviewError('')
      setPreviewLoading(false)
      return
    }
    let cancelled = false
    const load = async () => {
      setPreviewLoading(true)
      setPreviewError('')
      const params = new URLSearchParams({ scopeType: scope })
      if (scope !== 'all') params.set('trainingProblemId', problemId)
      if (scope === 'user_problem') params.set('userId', userId)
      try {
        const data = await apiClient.query<{ matchedCount: number; inProgressCount: number }>(`/api/contests/${trainingId}/rejudge/preview?${params.toString()}`)
        if (!cancelled) setPreview(data)
      } catch (error) {
        if (!cancelled) setPreviewError(error instanceof Error ? error.message : '无法获取预计数量，请重试')
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [isOpen, ready, scope, problemId, userId, trainingId])

  const scopeCards = useMemo(() => [
    { value: 'all' as const, icon: ClipboardList, title: '全部比赛', meta: '全部用户 · 全部题目', description: '重新评测本场比赛中的所有本地提交' },
    { value: 'problem' as const, icon: ListChecks, title: '指定题目', meta: '全部用户 · 一个题目', description: '只重新评测所选题目的提交' },
    { value: 'user_problem' as const, icon: UserRound, title: '指定用户 + 题目', meta: '一个用户 · 一个题目', description: '只重新评测指定用户在指定题目上的提交' },
  ], [])

  const submit = async () => {
    if (!ready || !preview || preview.matchedCount === 0 || submitting) return
    setSubmitting(true)
    setMessage(null)
    const selectedScope = scope === 'all' ? { type: 'all' } : scope === 'problem' ? { type: 'problem', trainingProblemId: problemId } : { type: 'user_problem', trainingProblemId: problemId, userId }
    const result = await apiClient.mutate<{ resetCount: number; skippedCount: number }>(`/api/contests/${trainingId}/rejudge`, 'POST', { scope: selectedScope })
    setSubmitting(false)
    if (!result.ok) {
      setMessage({ type: 'error', text: result.error.message })
      return
    }
    await onSuccess()
    onClose()
  }

  return (
    <FormDialog isOpen={isOpen} onClose={onClose} title="重新评测比赛" size="lg" footer={
      <div className={styles.footer}>
        <Button variant="text" onClick={onClose} disabled={submitting}>取消</Button>
        <Button variant="danger" icon={submitting ? <LoaderCircle className={styles.spin} size={16} /> : <RotateCcw size={16} />} disabled={!ready || previewLoading || !preview || preview.matchedCount === 0 || submitting} onClick={() => void submit()}>
          {submitting ? '正在重测…' : preview?.matchedCount ? `确认重测（${preview.matchedCount} 条）` : '确认重测'}
        </Button>
      </div>
    }>
      <div className={styles.content}>
        <div className={styles.context}><span className={styles.contextLabel}>当前比赛</span><strong>{trainingTitle}</strong></div>
        <p className={styles.lead}>选择要重新运行的提交范围。排队中和评测中的提交不会重复加入队列。</p>

        <div className={styles.scopeGrid} role="radiogroup" aria-label="重测范围">
          {scopeCards.map(card => {
            const Icon = card.icon
            const selected = scope === card.value
            return <Button variant="ghost" key={card.value} type="button" role="radio" aria-checked={selected} className={`${styles.scopeCard} ${selected ? styles.scopeCardSelected : ''}`} onClick={() => { setScope(card.value); if (card.value !== 'user_problem') setUserId('') }}>
              <span className={styles.scopeIcon}><Icon size={19} /></span><span className={styles.scopeCopy}><strong>{card.title}</strong><small>{card.meta}</small><span>{card.description}</span></span>{selected && <span className={styles.check}><Check size={15} /></span>}
            </Button>
          })}
        </div>

        {scope !== 'all' && <div className={styles.fields}>
          <label className={styles.field}><span>重测题目</span><Select value={problemId} onChange={event => setProblemId(event.target.value)}><option value="">选择题目</option>{problems.map(problem => <option key={problem.id} value={problem.id}>{problem.alias ? `${problem.alias} · ` : ''}{problem.problemTitle || problem.id}</option>)}</Select></label>
          {scope === 'user_problem' && <label className={styles.field}><span>重测用户</span><Select value={userId} onChange={event => setUserId(event.target.value)} disabled={usersLoading}><option value="">{usersLoading ? '正在加载用户…' : '选择用户'}</option>{users.map(user => <option key={user.id} value={user.id}>{user.displayName && user.displayName !== user.username ? `${user.displayName} · ` : ''}{user.username}</option>)}</Select></label>}
        </div>}

        {selectionHint && <div className={styles.hint}>{selectionHint}</div>}
        {ready && <div className={styles.preview}><div className={styles.previewHeader}><span>影响预览</span>{selectedProblem && <small>{selectedProblem.alias || selectedProblem.problemTitle}</small>}{selectedUser && <small>{selectedUser.username}</small>}</div>{previewLoading ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={17} />正在计算预计影响数量…</div> : previewError ? <div className={styles.error}>{previewError}</div> : preview && <div className={styles.metrics}><div><strong>{preview.matchedCount}</strong><span>可重新评测</span></div><div><strong>{preview.inProgressCount}</strong><span>正在评测，将跳过</span></div></div>}</div>}
        {ready && preview && preview.matchedCount === 0 && <div className={styles.empty}>暂无可重测提交</div>}
        <div className={styles.warning}><AlertTriangle size={18} /><p><strong>请确认操作范围</strong>重测会清空所选提交当前的结果、分数、耗时、内存和测试点详情，并重新加入评测队列。正在评测中的提交不会重复加入。</p></div>
        {message && <div className={message.type === 'error' ? styles.error : styles.success}>{message.text}</div>}
      </div>
    </FormDialog>
  )
}
