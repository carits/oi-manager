'use client'

import { useCallback, useEffect, useState } from 'react'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/FormControls'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import apiClient from '@/lib/apiClient'
import { createClientUUID } from '@/lib/uuid'
import { useToast } from '@/components/ui/Toast'
import styles from './page.module.css'

type Data = {
  pool: { availableTokens: string; reservedTokens: string; consumedTokens: string }
  entries: Array<{ id: string; type: string; amount: string; reason?: string; createdAt: string; availableAfter: string }>
}
type EvaluationData = {
  platform: { limitCredits: number; availableCredits: number; reservedCredits: number; consumedCredits: number }
  candidates: Array<{ status: string; count: number; bytes: number }>
  blobs: { count: number; bytes: number; orphanCount: number; orphanBytes: number }
  users: Array<{ id: string; subjectId: string; limitCredits: number; availableCredits: number; reservedCredits: number; consumedCredits: number }>
}
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(2)} MiB` : `${value} B`

export default function PlatformAiPage() {
  const toast = useToast()
  const [data, setData] = useState<Data | null>(null)
  const [evaluation, setEvaluation] = useState<EvaluationData | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    const [result, evaluationResult] = await Promise.all([
      apiClient.get<Data>('/api/platform-admin/ai/token-usage'),
      apiClient.get<EvaluationData>('/api/platform-admin/ai/evaluation-budget'),
    ])
    if (result.success && result.data) setData(result.data)
    if (evaluationResult.success && evaluationResult.data) setEvaluation(evaluationResult.data)
  }, [])
  useEffect(() => { void load() }, [load])

  const adjust = async () => {
    setSaving(true)
    try {
      const result = await apiClient.post('/api/platform-admin/ai/token-pool/adjust', {
        amount: Number(amount), reason, idempotencyKey: `admin:${Date.now()}:${createClientUUID()}`,
      })
      if (!result.success) return toast.error(result.message || 'Token 调整失败')
      setAmount(''); setReason(''); toast.success('Token 总池已调整'); await load()
    } finally { setSaving(false) }
  }

  return <PageFrame width="workbench">
    <PageHeader title="DeepSeek Token 总池" description="统一管理题面翻译、格式化和 AI Validator 的真实 Token 配额。" />
    <div className={styles.summary}>
      <div><span>可用</span><strong>{data?.pool.availableTokens || '—'}</strong></div>
      <div><span>预占</span><strong>{data?.pool.reservedTokens || '—'}</strong></div>
      <div><span>已消费</span><strong>{data?.pool.consumedTokens || '—'}</strong></div>
    </div>
    <section className={styles.card}>
      <h2>调整额度</h2>
      <div className={styles.form}><Input type="number" value={amount} onChange={event => setAmount(event.target.value)} placeholder="正数充值，负数扣减" /><Input value={reason} onChange={event => setReason(event.target.value)} placeholder="审计原因" /><Button variant="primary" disabled={saving || !Number(amount) || !reason.trim()} onClick={adjust}>{saving ? '提交中…' : '确认调整'}</Button></div>
    </section>
    <section className={styles.card}>
      <h2>Candidate 评估资源</h2>
      <div className={styles.summary}>
        <div><span>平台今日可用 Credits</span><strong>{evaluation?.platform.availableCredits ?? '—'}</strong></div>
        <div><span>Candidate HOT 数据</span><strong>{bytes(evaluation?.candidates.reduce((sum, item) => sum + item.bytes, 0) || 0)}</strong></div>
        <div><span>全局 Blob / 孤儿</span><strong>{evaluation ? `${evaluation.blobs.count} / ${evaluation.blobs.orphanCount}` : '—'}</strong></div>
      </div>
      <TableRoot><TableHead><TableRow><TableHeaderCell>用户 ID</TableHeaderCell><TableHeaderCell>今日额度</TableHeaderCell><TableHeaderCell>已消费</TableHeaderCell><TableHeaderCell>预占</TableHeaderCell><TableHeaderCell>可用</TableHeaderCell></TableRow></TableHead><TableBody>{evaluation?.users.map(item => <TableRow key={item.id}><TableCell>{item.subjectId}</TableCell><TableCell>{item.limitCredits}</TableCell><TableCell>{item.consumedCredits}</TableCell><TableCell>{item.reservedCredits}</TableCell><TableCell>{item.availableCredits}</TableCell></TableRow>)}</TableBody></TableRoot>
    </section>
    <section className={styles.card}>
      <h2>Token 流水</h2>
      <TableRoot><TableHead><TableRow><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>类型</TableHeaderCell><TableHeaderCell>变动</TableHeaderCell><TableHeaderCell>可用余额</TableHeaderCell><TableHeaderCell>原因</TableHeaderCell></TableRow></TableHead><TableBody>{data?.entries.map(item => <TableRow key={item.id}><TableCell>{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell><TableCell>{item.type}</TableCell><TableCell>{item.amount}</TableCell><TableCell>{item.availableAfter}</TableCell><TableCell>{item.reason || '—'}</TableCell></TableRow>)}</TableBody></TableRoot>
    </section>
  </PageFrame>
}
