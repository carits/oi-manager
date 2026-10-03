'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AiTokenUsage, EvaluationBudgetOverview } from '@oi-manager/contracts'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/FormControls'
import { LoadError } from '@/components/ui/LoadError'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import { createClientUUID } from '@/lib/uuid'
import { useToast } from '@/components/ui/Toast'
import { adjustAiTokenPool, getAiTokenUsage, getEvaluationBudget } from '../api/aiGovernanceApi'
import styles from '../AiGovernance.module.css'

const LEDGER_TYPE_LABELS: Record<string, string> = { adjustment: '额度调整', reserve: '额度预占', consume: '实际使用', release: '释放预占', refund: '退回额度' }

const ledgerTypeLabel = (value: string) => LEDGER_TYPE_LABELS[value] || '资源变动'

const bytes = (value: number) => value >= 1024 ** 3
  ? `${(value / 1024 ** 3).toFixed(2)} GiB`
  : value >= 1024 ** 2
    ? `${(value / 1024 ** 2).toFixed(2)} MiB`
    : `${value} B`

export function PlatformAiGovernancePage() {
  const toast = useToast()
  const [data, setData] = useState<AiTokenUsage | null>(null)
  const [evaluation, setEvaluation] = useState<EvaluationBudgetOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError('')
    try {
      const [usage, budget] = await Promise.all([
        getAiTokenUsage(signal),
        getEvaluationBudget(signal),
      ])
      setData(usage)
      setEvaluation(budget)
    } catch (loadError) {
      if (signal?.aborted) return
      console.error(loadError)
      setError('平台 AI 资源数据加载失败，请重试。')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const parsedAmount = Number(amount)
  const canSubmit = Number.isSafeInteger(parsedAmount) && parsedAmount !== 0 && reason.trim().length >= 2

  const adjust = async () => {
    if (!canSubmit) return
    setSaving(true)
    try {
      const result = await adjustAiTokenPool({
        amount: parsedAmount,
        reason: reason.trim(),
        idempotencyKey: `admin:${Date.now()}:${createClientUUID()}`,
      })
      if (!result.ok) {
        toast.error(result.error.userMessage || 'Token 调整失败')
        return
      }
      setAmount('')
      setReason('')
      toast.success('Token 总池已调整')
      await load()
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) {
    return <PageFrame width="workbench"><PageHeader title="DeepSeek Token 总池" description="统一管理题面翻译、格式化和 AI 输入检查功能的 Token 配额。" /><SkeletonRegion rows={8} label="AI 资源治理数据正在准备" /></PageFrame>
  }

  if (error && !data) {
    return <PageFrame width="workbench"><PageHeader title="DeepSeek Token 总池" description="统一管理题面翻译、格式化和 AI 输入检查功能的 Token 配额。" /><LoadError message={error} onRetry={() => void load()} /></PageFrame>
  }

  return <PageFrame width="workbench">
    <PageHeader title="DeepSeek Token 总池" description="统一管理题面翻译、格式化和 AI 输入检查功能的 Token 配额。" />
    {error && <LoadError compact message={error} onRetry={() => void load()} />}
    <div className={styles.summary} aria-busy={loading}>
      <div><span>可用</span><strong>{data?.pool.availableTokens ?? '—'}</strong></div>
      <div><span>预占</span><strong>{data?.pool.reservedTokens ?? '—'}</strong></div>
      <div><span>已消费</span><strong>{data?.pool.consumedTokens ?? '—'}</strong></div>
    </div>
    <section className={styles.card}>
      <h2>调整额度</h2>
      <p className={styles.hint}>调整会写入不可变审计流水。正数充值，负数扣减；扣减后可用余额不能为负。</p>
      <div className={styles.form}>
        <Input aria-label="Token 调整量" type="number" step="1" value={amount} onChange={event => setAmount(event.target.value)} placeholder="正数充值，负数扣减" />
        <Input aria-label="调整原因" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="审计原因（至少 2 个字符）" />
        <Button variant="primary" disabled={saving || !canSubmit} onClick={() => void adjust()}>{saving ? '提交中…' : '确认调整'}</Button>
      </div>
    </section>
    <section className={styles.card}>
      <h2>自动质量检查资源</h2>
      <div className={styles.summary}>
        <div><span>平台今日可用检查额度</span><strong>{evaluation?.platform.availableCredits ?? '—'}</strong></div>
        <div><span>候选数据占用</span><strong>{bytes(evaluation?.candidates.reduce((sum, item) => sum + item.bytes, 0) ?? 0)}</strong></div>
        <div><span>文件 / 未关联文件</span><strong>{evaluation ? `${evaluation.blobs.count} / ${evaluation.blobs.orphanCount}` : '—'}</strong></div>
      </div>
      <div className={styles.tableScroll}>
        <TableRoot><TableHead><TableRow><TableHeaderCell>用户</TableHeaderCell><TableHeaderCell>今日额度</TableHeaderCell><TableHeaderCell>已消费</TableHeaderCell><TableHeaderCell>预占</TableHeaderCell><TableHeaderCell>可用</TableHeaderCell></TableRow></TableHead><TableBody>
          {evaluation?.users.length ? evaluation.users.map(item => <TableRow key={item.id}><TableCell>{item.username}</TableCell><TableCell>{item.limitCredits}</TableCell><TableCell>{item.consumedCredits}</TableCell><TableCell>{item.reservedCredits}</TableCell><TableCell>{item.availableCredits}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5}>今日暂无用户评估消耗</TableCell></TableRow>}
        </TableBody></TableRoot>
      </div>
    </section>
    <section className={styles.card}>
      <h2>Token 流水</h2>
      <div className={styles.tableScroll}>
        <TableRoot><TableHead><TableRow><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>类型</TableHeaderCell><TableHeaderCell>变动</TableHeaderCell><TableHeaderCell>可用余额</TableHeaderCell><TableHeaderCell>原因</TableHeaderCell></TableRow></TableHead><TableBody>
          {data?.entries.length ? data.entries.map(item => <TableRow key={item.id}><TableCell>{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell><TableCell>{ledgerTypeLabel(item.type)}</TableCell><TableCell>{item.amount}</TableCell><TableCell>{item.availableAfter}</TableCell><TableCell>{item.reason || '—'}</TableCell></TableRow>) : <TableRow><TableCell colSpan={5}>暂无 Token 流水</TableCell></TableRow>}
        </TableBody></TableRoot>
      </div>
    </section>
  </PageFrame>
}
