'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import collisionStyles from './ProblemHackPanel.collision.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { getLanguageLabel } from '@/lib/judge-constants'
import styles from './ProblemHackPanel.module.css'

type InputChoice = 'data' | 'cpp17' | 'python3'
interface Attempt {
  id: string
  username?: string
  status: string
  inputMode: string
  generatorLanguage?: string | null
  hackLanguage: string
  baselineResult?: string | null
  baselineScore?: number | null
  candidateResult?: string | null
  candidateScore?: number | null
  scoreDelta?: number | null
  baseTestSetRevision?: number | null
  promotedRevision?: number | null
  canonicalStatus?: string | null
  affectedSubtaskIds?: number[]
  failureStage?: string | null
  message?: string | null
  createdAt: string
  inputData?: string | null
  generatorSource?: string | null
  hackSource?: string | null
}

const STATUS: Record<string, string> = {
  queuing: '排队中', judging: '验证与评测中', accepted: '有效 Hack', rejected: '无效 Hack',
  system_error: '系统错误', stale: '配置已变化',
}

const FAILURE_STAGE: Record<string, string> = {
  input: '候选输入', generator: '数据生成器', validator: 'Validator', classifier: 'Classifier', standard: '标准程序', checker: 'Checker 自检',
  baseline: '原始完整评测', candidate: '加入候选点后评测', persist: '测试数据入库', stale: '配置一致性检查',
}

export function ProblemHackPanel({ problemId, acceptedCount, languages, mode }: {
  problemId: string
  acceptedCount: number
  languages: string[]
  mode: 'acm' | 'oi'
}) {
  const toast = useToast()
  const [choice, setChoice] = useState<InputChoice>('data')
  const [candidate, setCandidate] = useState('')
  const [hackSource, setHackSource] = useState('')
  const [hackLanguage, setHackLanguage] = useState(languages[0] || '')
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [canManage, setCanManage] = useState(false)
  const [totalAccepted, setTotalAccepted] = useState(acceptedCount)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [expandedAttemptId, setExpandedAttemptId] = useState<string | null>(null)
  const [attemptDetails, setAttemptDetails] = useState<Record<string, Attempt>>({})
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await apiClient.get<{ attempts: Attempt[]; acceptedCount: number; canManage: boolean }>(`/api/problems/${problemId}/hacks?pageSize=50`)
    if (result.success && result.data) {
      setAttempts(result.data.attempts)
      setCanManage(result.data.canManage)
      setTotalAccepted(result.data.acceptedCount)
    }
    setLoading(false)
  }, [problemId])

  useEffect(() => { load() }, [load])
  const hasActive = useMemo(() => attempts.some(item => item.status === 'queuing' || item.status === 'judging'), [attempts])
  useEffect(() => {
    if (!hasActive) return
    const timer = window.setInterval(load, 2000)
    return () => window.clearInterval(timer)
  }, [hasActive, load])

  const readFile = async (file: File | undefined, setter: (value: string) => void, limit: number) => {
    if (!file) return
    if (file.size > limit) return toast.error(`文件不能超过 ${limit === 1024 * 1024 ? '1 MiB' : '256 KiB'}`)
    setter(await file.text())
  }

  const submit = async () => {
    if (!candidate.trim() || !hackSource.trim()) return toast.error('请完整填写候选输入和被 Hack 程序')
    setSubmitting(true)
    try {
      const result = await apiClient.post<Attempt>(`/api/problems/${problemId}/hacks`, {
        inputMode: choice === 'data' ? 'data' : 'generator',
        inputData: choice === 'data' ? candidate : undefined,
        generatorSource: choice === 'data' ? undefined : candidate,
        generatorLanguage: choice === 'data' ? undefined : choice,
        hackSource,
        hackLanguage,
      })
      if (!result.success) return toast.error(result.message || 'Hack 提交失败')
      toast.success('Hack 已加入独立评测队列')
      setCandidate('')
      setHackSource('')
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  const retry = async (id: string) => {
    const result = await apiClient.post(`/api/problems/${problemId}/hacks/${id}/retry`)
    if (!result.success) return toast.error(result.message || '重新执行失败')
    toast.success('已重新加入队列')
    await load()
  }

  const toggleDetails = async (attempt: Attempt) => {
    if (expandedAttemptId === attempt.id) {
      setExpandedAttemptId(null)
      return
    }
    setExpandedAttemptId(attempt.id)
    if (attemptDetails[attempt.id]) return
    setLoadingDetailId(attempt.id)
    try {
      const result = await apiClient.get<Attempt>(`/api/problems/${problemId}/hacks/${attempt.id}`)
      if (!result.success || !result.data) return toast.error(result.message || 'Hack 详情加载失败')
      setAttemptDetails(current => ({ ...current, [attempt.id]: result.data! }))
    } finally {
      setLoadingDetailId(current => current === attempt.id ? null : current)
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.hero}>
        <div><h2 className={styles.title}>题目级 {mode === 'oi' ? 'OI / IOI' : 'ACM'} Hack</h2><p className={styles.description}>{mode === 'oi' ? 'Classifier 会自动确定候选数据命中的 Subtask。系统分别按当前测试图和加入 Hack Gate 后的测试图完整评测；总分下降才会把数据加入正式测试。' : '提交候选输入和一份用于证明数据有效性的程序。系统会先运行当前完整数据，再将候选点放在最前面重新完整评测；最终 Verdict 发生变化才会把数据加入正式测试。'}</p></div>
        <span className={styles.count}>已加入 {totalAccepted} 个有效 Hack</span>
      </div>

      <div className={styles.form}>
        <div className={styles.modeGrid} role="radiogroup" aria-label="候选输入方式">
          {([
            ['data', '直接数据', '填写或上传完整输入数据'],
            ['cpp17', 'C++17 生成器', '程序标准输出作为候选输入'],
            ['python3', 'Python3 生成器', '程序标准输出作为候选输入'],
          ] as const).map(([value, title, hint]) => (
            <Button variant="ghost" key={value} type="button" role="radio" aria-checked={choice === value} className={`${styles.mode} ${choice === value ? styles.modeActive : ''}`} onClick={() => { setChoice(value); setCandidate('') }}>
              <span className={styles.modeTitle}>{title}</span><span className={styles.modeHint}>{hint}</span>
            </Button>
          ))}
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}><span className={styles.label}>{choice === 'data' ? '候选输入数据' : `${choice === 'cpp17' ? 'C++17' : 'Python3'} 数据生成器`}</span><label className={styles.upload}>上传文件<Input type="file" accept={choice === 'data' ? '.in,.txt,text/plain' : choice === 'cpp17' ? '.cpp,.cc,.cxx,text/plain' : '.py,text/plain'} onChange={event => readFile(event.target.files?.[0], setCandidate, choice === 'data' ? 1024 * 1024 : 256 * 1024)} /></label></div>
          <Textarea className={styles.textarea} spellCheck={false} value={candidate} onChange={event => setCandidate(event.target.value)} placeholder={choice === 'data' ? '填写完整输入数据…' : '填写生成器源码，程序应将一组完整输入输出到 stdout…'} />
        </div>

        <div className={styles.twoColumns}>
          <div className={styles.field}><span className={styles.label}>被 Hack 程序语言</span><Select className={styles.select} value={hackLanguage} disabled={languages.length === 0} onChange={event => setHackLanguage(event.target.value)}>{languages.length === 0 ? <option value="">题目没有可用的本地语言</option> : languages.map(language => <option key={language} value={language}>{getLanguageLabel(language)}</option>)}</Select></div>
          <div className={styles.warning}>有效 Hack 会直接加入题目测试数据。普通训练和未开始活动自动同步；进行中或已结束比赛由管理员手动同步。历史提交、成绩和排行榜不会自动重测。</div>
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}><span className={styles.label}>用于证明的被 Hack 程序</span><label className={styles.upload}>上传源码<Input type="file" accept=".c,.cc,.cpp,.cxx,.py,text/plain" onChange={event => readFile(event.target.files?.[0], setHackSource, 256 * 1024)} /></label></div>
          <Textarea className={styles.textarea} spellCheck={false} value={hackSource} onChange={event => setHackSource(event.target.value)} placeholder={mode === 'oi' ? '填写加入候选数据后总分会下降的证明程序…' : '填写在加入候选数据前后会产生不同最终 Verdict 的程序…'} />
        </div>
        <div className={styles.submitRow}><Button variant="ghost" type="button" className={styles.submit} disabled={submitting || hasActive || !candidate.trim() || !hackSource.trim() || !hackLanguage} onClick={submit}>{hasActive ? '已有 Hack 正在处理' : submitting ? '正在提交…' : '发起 Hack'}</Button></div>
      </div>

      <section className={styles.history}>
        <h3 className={styles.historyTitle}>{canManage ? '本题全部 Hack 记录' : '我的 Hack 记录'}</h3>
        {loading ? <div className={styles.empty}>正在加载…</div> : attempts.length === 0 ? <div className={styles.empty}>暂无 Hack 记录</div> : (
          <div className={styles.tableWrap}><TableRoot className={styles.table}><TableHead><TableRow><TableHeaderCell>时间</TableHeaderCell>{canManage && <TableHeaderCell>用户</TableHeaderCell>}<TableHeaderCell>输入方式</TableHeaderCell><TableHeaderCell>程序语言</TableHeaderCell><TableHeaderCell>Hack 程序</TableHeaderCell><TableHeaderCell>前后 Verdict</TableHeaderCell><TableHeaderCell>状态</TableHeaderCell><TableHeaderCell>失败阶段</TableHeaderCell><TableHeaderCell>说明</TableHeaderCell></TableRow></TableHead><TableBody>{attempts.map(item => {
            const detail = attemptDetails[item.id]
            const comparison = mode === 'oi' && item.baselineScore != null ? `${item.baselineScore} → ${item.candidateScore ?? '—'}${item.scoreDelta ? `（-${item.scoreDelta}）` : ''}${item.affectedSubtaskIds?.length ? ` · S${item.affectedSubtaskIds.join(', S')}` : ''}` : item.baselineResult ? `${item.baselineResult} → ${item.candidateResult || '—'}` : '—'
            return <Fragment key={item.id}><TableRow><TableCell>{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell>{canManage && <TableCell>{item.username || '-'}</TableCell>}<TableCell>{item.inputMode === 'data' ? '直接数据' : item.generatorLanguage}</TableCell><TableCell>{getLanguageLabel(item.hackLanguage)}</TableCell><TableCell><div className={styles.actions}><Button variant="ghost" type="button" className={styles.retry} disabled={loadingDetailId === item.id} onClick={() => toggleDetails(item)}>{loadingDetailId === item.id ? '读取中…' : expandedAttemptId === item.id ? '收起程序' : '查看程序'}</Button>{canManage && item.status === 'system_error' && <Button variant="ghost" type="button" className={styles.retry} onClick={() => retry(item.id)}>重新执行</Button>}</div></TableCell><TableCell>{comparison}</TableCell><TableCell><span className={`${styles.status} ${item.status === 'accepted' ? styles.accepted : item.status === 'rejected' ? styles.rejected : item.status === 'system_error' || item.status === 'stale' ? styles.error : ''}`}>{STATUS[item.status] || item.status}</span></TableCell><TableCell>{item.failureStage ? FAILURE_STAGE[item.failureStage] || item.failureStage : '—'}</TableCell><TableCell title={item.message || ''}>{item.message || '—'}</TableCell></TableRow>{expandedAttemptId === item.id && <TableRow><TableCell colSpan={canManage ? 9 : 8} className={styles.detailCell}>{detail ? <div className={styles.detailGrid}><section><strong>{detail.inputMode === 'data' ? '候选输入' : `${detail.generatorLanguage} 生成器`}</strong><pre>{detail.inputMode === 'data' ? detail.inputData : detail.generatorSource}</pre></section><section><strong>被 Hack 程序（{getLanguageLabel(detail.hackLanguage)}）</strong><pre>{detail.hackSource}</pre></section></div> : <div className={styles.detailLoading}><span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="Hack 详情正在准备" /></div>}</TableCell></TableRow>}</Fragment>
          })}</TableBody></TableRoot></div>
        )}
      </section>
    </div>
  )
}
