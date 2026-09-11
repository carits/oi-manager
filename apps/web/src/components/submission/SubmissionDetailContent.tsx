'use client'

import { useMemo, useState } from 'react'
import hljs from 'highlight.js'
import 'highlight.js/styles/github.css'
import { Button } from '@/components/ui/Button'
import { StatusBadge, getResultVariant } from '@/components/ui/StatusBadge'
import { JUDGE_RESULT_LABEL_MAP, getLanguageLabel } from '@/lib/judge-constants'
import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { SubmissionJudgeResult } from './SubmissionJudgeResult'
import type { SubmissionDetailDto } from './submission-detail.types'
import type { SubmissionDetailLoadError } from './useSubmissionDetail'
import styles from './SubmissionDetailContent.module.css'

const HIGHLIGHT_LANGUAGE: Record<string, string> = {
  c: 'c', cpp: 'cpp', csharp: 'csharp', java: 'java', python: 'python', pascal: 'delphi',
  go: 'go', rust: 'rust', javascript: 'javascript', typescript: 'typescript', kotlin: 'kotlin',
  ruby: 'ruby', php: 'php', lua: 'lua', perl: 'perl', scala: 'scala', swift: 'swift', haskell: 'haskell',
  '0': 'cpp', '1': 'c', '2': 'cpp', '3': 'c', '4': 'delphi', '5': 'java', '6': 'csharp',
}

function copyText(value: string) {
  if (navigator.clipboard) return navigator.clipboard.writeText(value)
  const element = document.createElement('textarea')
  element.value = value
  element.style.position = 'fixed'
  element.style.opacity = '0'
  document.body.appendChild(element)
  element.select()
  document.execCommand('copy')
  element.remove()
  return Promise.resolve()
}

export function submissionDetailTitle(detail: SubmissionDetailDto) {
  const problem = detail.problemSourceHidden || detail.problemIdentityHidden
    ? '比赛题目'
    : [detail.problemAlias || detail.problemId, detail.problemTitle].filter(Boolean).join(' · ')
  return `提交 #${detail.id} · ${detail.username}${problem ? ` · ${problem}` : ''}`
}

export function SubmissionDetailErrorState({ error, onRetry, onBack }: {
  error: SubmissionDetailLoadError
  onRetry: () => void
  onBack?: () => void
}) {
  const permanent = error.status === 403 || error.status === 404
  return (
    <div className={styles.errorState} role="alert">
      <h3 className={styles.errorTitle}>{error.status === 404 ? '提交记录不存在' : error.status === 403 ? '无法查看该提交' : '评测详情加载失败'}</h3>
      <p className={styles.errorMessage}>{error.message}</p>
      {error.requestId && <span className={styles.requestId}>请求编号：{error.requestId}</span>}
      <div className={styles.errorActions}>
        {onBack && <Button variant="secondary" onClick={onBack}>{permanent ? '关闭' : '返回'}</Button>}
        {!permanent && <Button onClick={onRetry}>重试</Button>}
      </div>
    </div>
  )
}

export function SubmissionDetailContent({ detail }: { detail: SubmissionDetailDto }) {
  const [copied, setCopied] = useState(false)
  const highlighted = useMemo(() => {
    if (!detail.code) return ''
    try { return hljs.highlight(detail.code, { language: HIGHLIGHT_LANGUAGE[detail.language] || 'cpp' }).value }
    catch { return detail.code }
  }, [detail.code, detail.language])
  const shownResult = detail.hidden || detail.displayResult === 'pending' ? 'pending' : detail.result || ''
  const resultLabel = detail.hidden || detail.displayResult === 'pending'
    ? '已提交'
    : JUDGE_RESULT_LABEL_MAP[detail.result || ''] || detail.result || '-'
  const sourceLabel = detail.sourcePlatform
    ? OJ_PLATFORM_LABEL_MAP[detail.sourcePlatform] || detail.sourcePlatform
    : null

  return (
    <div className={styles.content}>
      <section className={styles.summary} aria-label="提交摘要">
        <div className={styles.metric}><span className={styles.metricLabel}>评测结果</span><span><StatusBadge variant={getResultVariant(shownResult)} dot={shownResult === 'queuing' || shownResult === 'judging'}>{resultLabel}</StatusBadge></span></div>
        {detail.judgeMode === 'oi' && !detail.hidden && <div className={styles.metric}><span className={styles.metricLabel}>分数</span><span className={styles.metricValue}>{detail.score ?? '-'}</span></div>}
        {!detail.hidden && <div className={styles.metric}><span className={styles.metricLabel}>耗时</span><span className={styles.metricValue}>{detail.timeUsed != null ? `${detail.timeUsed} ms` : '-'}</span></div>}
        {!detail.hidden && <div className={styles.metric}><span className={styles.metricLabel}>内存</span><span className={styles.metricValue}>{detail.memoryUsed != null ? `${(detail.memoryUsed / 1024).toFixed(2)} MB` : '-'}</span></div>}
        <div className={styles.metric}><span className={styles.metricLabel}>语言</span><span className={styles.metricValue}>{getLanguageLabel(detail.language)}</span></div>
        <div className={styles.metric}><span className={styles.metricLabel}>代码长度</span><span className={styles.metricValue}>{detail.codeLength} B</span></div>
        <div className={styles.metric}><span className={styles.metricLabel}>输入</span><span className={styles.metricValue}>{detail.io?.input.type === 'file' ? detail.io.input.filename : 'stdin'}</span></div>
        <div className={styles.metric}><span className={styles.metricLabel}>输出</span><span className={styles.metricValue}>{detail.io?.output.type === 'file' ? detail.io.output.filename : 'stdout'}</span></div>
      </section>

      <section className={styles.meta} aria-label="提交信息">
        <span>提交人：{detail.submitterName || detail.username}</span>
        <span>提交时间：{new Date(detail.submittedAt).toLocaleString('zh-CN')}</span>
        {!detail.problemSourceHidden && sourceLabel && detail.sourceProblemId && <span>来源：{sourceLabel} · {detail.sourceProblemId}</span>}
      </section>

      {detail.errorMessage && <div className={styles.warning}>{detail.errorMessage}</div>}
      <SubmissionJudgeResult key={detail.id} judgeMode={detail.judgeMode} result={detail.result} score={detail.score} cases={detail.cases} subtasks={detail.subtasks} hidden={detail.hidden} />

      <section className={styles.codePanel} aria-label="源代码">
        <div className={styles.codeToolbar}>
          <h3 className={styles.codeTitle}>源代码</h3>
          {detail.code && <Button size="sm" variant="secondary" onClick={() => void copyText(detail.code!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })}>{copied ? '已复制' : '复制代码'}</Button>}
        </div>
        {detail.code
          ? <pre className={styles.code}><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
          : <div className={styles.emptyCode}>{detail.canViewCode === false ? '当前账号无权查看源代码' : '该评测记录未保存源代码'}</div>}
      </section>
    </div>
  )
}
