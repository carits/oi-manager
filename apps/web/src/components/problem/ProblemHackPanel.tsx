'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
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
  candidateResult?: string | null
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
  input: '候选输入', generator: '数据生成器', validator: 'Validator', standard: '标准程序',
  baseline: '原始完整评测', candidate: '加入候选点后评测', persist: '测试数据入库', stale: '配置一致性检查',
}

export function ProblemHackPanel({ problemId, acceptedCount, languages }: {
  problemId: string
  acceptedCount: number
  languages: string[]
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
        <div><h2 className={styles.title}>题目级 ACM Hack</h2><p className={styles.description}>提交候选输入和一份用于证明数据有效性的程序。系统会先运行当前完整数据，再将候选点放在最前面重新完整评测；最终 Verdict 发生变化才会把数据加入正式测试。</p></div>
        <span className={styles.count}>已加入 {totalAccepted} 个有效 Hack</span>
      </div>

      <div className={styles.form}>
        <div className={styles.modeGrid} role="radiogroup" aria-label="候选输入方式">
          {([
            ['data', '直接数据', '填写或上传完整输入数据'],
            ['cpp17', 'C++17 生成器', '程序标准输出作为候选输入'],
            ['python3', 'Python3 生成器', '程序标准输出作为候选输入'],
          ] as const).map(([value, title, hint]) => (
            <button key={value} type="button" role="radio" aria-checked={choice === value} className={`${styles.mode} ${choice === value ? styles.modeActive : ''}`} onClick={() => { setChoice(value); setCandidate('') }}>
              <span className={styles.modeTitle}>{title}</span><span className={styles.modeHint}>{hint}</span>
            </button>
          ))}
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}><span className={styles.label}>{choice === 'data' ? '候选输入数据' : `${choice === 'cpp17' ? 'C++17' : 'Python3'} 数据生成器`}</span><label className={styles.upload}>上传文件<input type="file" accept={choice === 'data' ? '.in,.txt,text/plain' : choice === 'cpp17' ? '.cpp,.cc,.cxx,text/plain' : '.py,text/plain'} onChange={event => readFile(event.target.files?.[0], setCandidate, choice === 'data' ? 1024 * 1024 : 256 * 1024)} /></label></div>
          <textarea className={styles.textarea} spellCheck={false} value={candidate} onChange={event => setCandidate(event.target.value)} placeholder={choice === 'data' ? '填写完整输入数据…' : '填写生成器源码，程序应将一组完整输入输出到 stdout…'} />
        </div>

        <div className={styles.twoColumns}>
          <div className={styles.field}><span className={styles.label}>被 Hack 程序语言</span><select className={styles.select} value={hackLanguage} disabled={languages.length === 0} onChange={event => setHackLanguage(event.target.value)}>{languages.length === 0 ? <option value="">题目没有可用的本地语言</option> : languages.map(language => <option key={language} value={language}>{getLanguageLabel(language)}</option>)}</select></div>
          <div className={styles.warning}>有效 Hack 会直接加入题目测试数据，并同步到所有 ACM 活动的后续新提交。已经完成的提交、成绩和排行榜不会重新评测。</div>
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}><span className={styles.label}>用于证明的被 Hack 程序</span><label className={styles.upload}>上传源码<input type="file" accept=".c,.cc,.cpp,.cxx,.py,text/plain" onChange={event => readFile(event.target.files?.[0], setHackSource, 256 * 1024)} /></label></div>
          <textarea className={styles.textarea} spellCheck={false} value={hackSource} onChange={event => setHackSource(event.target.value)} placeholder="填写在加入候选数据前后会产生不同最终 Verdict 的程序…" />
        </div>
        <div className={styles.submitRow}><button type="button" className={styles.submit} disabled={submitting || hasActive || !candidate.trim() || !hackSource.trim() || !hackLanguage} onClick={submit}>{hasActive ? '已有 Hack 正在处理' : submitting ? '正在提交…' : '发起 Hack'}</button></div>
      </div>

      <section className={styles.history}>
        <h3 className={styles.historyTitle}>{canManage ? '本题全部 Hack 记录' : '我的 Hack 记录'}</h3>
        {loading ? <div className={styles.empty}>正在加载…</div> : attempts.length === 0 ? <div className={styles.empty}>暂无 Hack 记录</div> : (
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>时间</th>{canManage && <th>用户</th>}<th>输入方式</th><th>程序语言</th><th>Hack 程序</th><th>前后 Verdict</th><th>状态</th><th>失败阶段</th><th>说明</th></tr></thead><tbody>{attempts.map(item => {
            const detail = attemptDetails[item.id]
            return <Fragment key={item.id}><tr><td>{new Date(item.createdAt).toLocaleString('zh-CN')}</td>{canManage && <td>{item.username || '-'}</td>}<td>{item.inputMode === 'data' ? '直接数据' : item.generatorLanguage}</td><td>{getLanguageLabel(item.hackLanguage)}</td><td><div className={styles.actions}><button type="button" className={styles.retry} disabled={loadingDetailId === item.id} onClick={() => toggleDetails(item)}>{loadingDetailId === item.id ? '读取中…' : expandedAttemptId === item.id ? '收起程序' : '查看程序'}</button>{canManage && item.status === 'system_error' && <button type="button" className={styles.retry} onClick={() => retry(item.id)}>重新执行</button>}</div></td><td>{item.baselineResult ? `${item.baselineResult} → ${item.candidateResult || '—'}` : '—'}</td><td><span className={`${styles.status} ${item.status === 'accepted' ? styles.accepted : item.status === 'rejected' ? styles.rejected : item.status === 'system_error' || item.status === 'stale' ? styles.error : ''}`}>{STATUS[item.status] || item.status}</span></td><td>{item.failureStage ? FAILURE_STAGE[item.failureStage] || item.failureStage : '—'}</td><td title={item.message || ''}>{item.message || '—'}</td></tr>{expandedAttemptId === item.id && <tr><td colSpan={canManage ? 9 : 8} className={styles.detailCell}>{detail ? <div className={styles.detailGrid}><section><strong>{detail.inputMode === 'data' ? '候选输入' : `${detail.generatorLanguage} 生成器`}</strong><pre>{detail.inputMode === 'data' ? detail.inputData : detail.generatorSource}</pre></section><section><strong>被 Hack 程序（{getLanguageLabel(detail.hackLanguage)}）</strong><pre>{detail.hackSource}</pre></section></div> : <div className={styles.detailLoading}><span className="resource-skeleton-line" style={{ display: 'inline-block', width: '10rem' }} aria-label="Hack 详情正在准备" /></div>}</td></tr>}</Fragment>
          })}</tbody></table></div>
        )}
      </section>
    </div>
  )
}
