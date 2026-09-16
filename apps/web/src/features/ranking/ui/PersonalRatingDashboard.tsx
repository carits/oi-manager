'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Award, History, TrendingUp } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { Empty } from '@/components/ui/Empty'
import { LoadError } from '@/components/ui/LoadError'
import { SkeletonRegion } from '@/components/ui/AsyncRegion'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/FormControls'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { RatingAccount, RatingHistoryItem } from '@oi-manager/contracts'
import { getMyRatingAccounts, getMyRatingHistory } from '../api/rankingApi'
import styles from './PersonalRatingDashboard.module.css'

function accountKey(account: RatingAccount) { return `${account.scope}:${account.organizationId || 'global'}:${account.track}` }
function accountLabel(account: RatingAccount) { return `${account.scope === 'GLOBAL' ? '全局' : account.organizationName || '组织'} · ${account.track}` }

function RatingCurve({ items }: { items: RatingHistoryItem[] }) {
  const chronological = [...items].reverse()
  if (chronological.length < 2) return <p className={styles.muted}>至少完成两场 Rated 比赛后显示 Rating 曲线。</p>
  const values = chronological.map(item => item.ratingAfter)
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const spread = Math.max(1, maximum - minimum)
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${36 - ((value - minimum) / spread) * 32}`).join(' ')
  return <div className={styles.curve} role="img" aria-label={`Rating 从 ${values[0]} 变化到 ${values.at(-1)}`}><svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} /></svg><span>{minimum}</span><strong>{maximum}</strong></div>
}

export function PersonalRatingDashboard() {
  const { user } = useAuth()
  const [accountsPayload, setAccountsPayload] = useState<{ baseRating: number; accounts: RatingAccount[] } | null>(null)
  const [history, setHistory] = useState<RatingHistoryItem[]>([])
  const [accountsError, setAccountsError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const accounts = useMemo(() => accountsPayload?.accounts || [], [accountsPayload])
  const [selected, setSelected] = useState('')
  useEffect(() => {
    if (!accounts.length) return
    if (!accounts.some(account => accountKey(account) === selected)) setSelected(accountKey(accounts[0]))
  }, [accounts, selected])
  const active = accounts.find(account => accountKey(account) === selected) || null
  useEffect(() => {
    let activeRequest = true
    setAccountsLoading(true)
    setAccountsError(null)
    void getMyRatingAccounts().then(data => { if (activeRequest) setAccountsPayload(data) })
      .catch(error => { if (activeRequest) setAccountsError(error instanceof Error ? error.message : 'Rating 账户加载失败') })
      .finally(() => { if (activeRequest) setAccountsLoading(false) })
    return () => { activeRequest = false }
  }, [reload])

  useEffect(() => {
    if (!active || !user?.userId) { setHistory([]); return }
    const controller = new AbortController()
    setHistoryLoading(true)
    setHistoryError(null)
    void getMyRatingHistory(user.userId, { page: 1, pageSize: 100, scope: active.scope, track: active.track, organizationId: active.organizationId || undefined }, controller.signal)
      .then(data => setHistory(data.items))
      .catch(error => { if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : 'Rating 历史加载失败') })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false) })
    return () => controller.abort()
  }, [active, user?.userId])

  return <Section title="我的 Rating" description="按全局/组织和 OI、IOI、ACM Track 独立记录；历史使用比赛冻结规则重放。">
    {accountsLoading ? <SkeletonRegion rows={3} /> : accountsError ? <LoadError message={accountsError} onRetry={() => setReload(value => value + 1)} /> : !accountsPayload ? <Empty text="暂无 Rating 账户" /> : accounts.length === 0 ? <div className={styles.empty}><strong>尚未参加 Rated 比赛</strong><span>首次完成符合条件的比赛后会建立对应 Rating 账户，初始值为 {accountsPayload.baseRating}。</span></div> : <div className={styles.stack}>
        <div className={styles.accountGrid}>{accounts.map(account => <Button variant="secondary" key={accountKey(account)} className={accountKey(account) === selected ? styles.accountActive : styles.account} onClick={() => setSelected(accountKey(account))} aria-pressed={accountKey(account) === selected}>
          <span>{accountLabel(account)}</span><strong>{account.rating}</strong><small>峰值 {account.peakRating} · {account.ratedContestCount} 场</small>
        </Button>)}</div>
        {active && <div className={styles.activeHeader}><span><Select aria-label="选择 Rating 账户" value={selected} onChange={event => setSelected(event.target.value)}>{accounts.map(account => <option key={accountKey(account)} value={accountKey(account)}>{accountLabel(account)}</option>)}</Select></span><StatusBadge variant={active.provisional ? 'warning' : 'success'}>{active.provisional ? '暂定 Rating' : '正式 Rating'}</StatusBadge></div>}
        {active && (historyLoading ? <SkeletonRegion rows={4} /> : historyError ? <LoadError message={historyError} onRetry={() => setSelected('')} /> : history.length === 0 ? <Empty text="该账户暂无比赛记录" /> : <div className={styles.historyLayout}>
            <div><div className={styles.metricRow}><span><TrendingUp size={16} />当前 <strong>{active.rating}</strong></span><span><Award size={16} />峰值 <strong>{active.peakRating}</strong></span><span><History size={16} />比赛 <strong>{active.ratedContestCount}</strong></span></div><RatingCurve items={history} /></div>
            <div className={styles.historyList}>{history.map(item => <Link href={`/personal/contests/${item.contest.id}`} className={styles.historyItem} key={item.id}><span><strong>{item.contest.title}</strong><small>第 {item.rank}/{item.fieldSize} 名 · {new Date(item.contest.endTime).toLocaleDateString('zh-CN')}</small></span><span className={item.appliedDelta >= 0 ? styles.positive : styles.negative}>{item.appliedDelta >= 0 ? '+' : ''}{item.appliedDelta}<small>{item.ratingBefore} → {item.ratingAfter}</small></span></Link>)}</div>
          </div>)}
      </div>}
  </Section>
}
