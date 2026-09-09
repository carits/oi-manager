'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Award, History, TrendingUp } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/FormControls'
import { Section } from '@/components/ui/Section'
import { StatusBadge } from '@/components/ui/StatusBadge'
import styles from './PersonalRatingDashboard.module.css'

type RatingAccount = {
  id: string
  rating: number
  peakRating: number
  ratedContestCount: number
  provisional: boolean
  lastRatedAt?: string | null
  track: 'OI' | 'IOI' | 'ACM'
  scope: 'GLOBAL' | 'ORGANIZATION'
  organizationId?: string | null
  organizationName?: string | null
}

type AccountsPayload = { baseRating: number; accounts: RatingAccount[]; missingTracksUseBaseRating: boolean }
type HistoryItem = { id: string; contest: { id: number; title: string; endTime: string }; rank: number; fieldSize: number; ratingBefore: number; appliedDelta: number; ratingAfter: number }
type HistoryPayload = { account: RatingAccount | null; data: HistoryItem[]; total: number }

function accountKey(account: RatingAccount) { return `${account.scope}:${account.organizationId || 'global'}:${account.track}` }
function accountLabel(account: RatingAccount) { return `${account.scope === 'GLOBAL' ? '全局' : account.organizationName || '组织'} · ${account.track}` }

function RatingCurve({ items }: { items: HistoryItem[] }) {
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
  const { user, sessionKey } = useAuth()
  const accountsResource = useResource<AccountsPayload>('/api/ratings/me', { sessionKey, isEmpty: () => false })
  const accounts = useMemo(() => accountsResource.data?.accounts || [], [accountsResource.data])
  const [selected, setSelected] = useState('')
  useEffect(() => {
    if (!accounts.length) return
    if (!accounts.some(account => accountKey(account) === selected)) setSelected(accountKey(accounts[0]))
  }, [accounts, selected])
  const active = accounts.find(account => accountKey(account) === selected) || null
  const query = active
    ? new URLSearchParams({ scope: active.scope, track: active.track, ...(active.organizationId ? { organizationId: active.organizationId } : {}), pageSize: '100' }).toString()
    : ''
  const historyResource = useResource<HistoryPayload>(active && user?.userId ? `/api/ratings/users/${user.userId}/history?${query}` : null, { sessionKey, isEmpty: () => false })

  return <Section title="我的 Rating" description="按全局/组织和 OI、IOI、ACM Track 独立记录；历史使用比赛冻结规则重放。">
    <AsyncRegion state={accountsResource.state} onRetry={accountsResource.retry} emptyText="暂无 Rating 账户" skeletonRows={3}>
      {data => data.accounts.length === 0 ? <div className={styles.empty}><strong>尚未参加 Rated 比赛</strong><span>首次完成符合条件的比赛后会建立对应 Rating 账户，初始值为 {data.baseRating}。</span></div> : <div className={styles.stack}>
        <div className={styles.accountGrid}>{data.accounts.map(account => <Button variant="secondary" key={accountKey(account)} className={accountKey(account) === selected ? styles.accountActive : styles.account} onClick={() => setSelected(accountKey(account))} aria-pressed={accountKey(account) === selected}>
          <span>{accountLabel(account)}</span><strong>{account.rating}</strong><small>峰值 {account.peakRating} · {account.ratedContestCount} 场</small>
        </Button>)}</div>
        {active && <div className={styles.activeHeader}><span><Select aria-label="选择 Rating 账户" value={selected} onChange={event => setSelected(event.target.value)}>{data.accounts.map(account => <option key={accountKey(account)} value={accountKey(account)}>{accountLabel(account)}</option>)}</Select></span><StatusBadge variant={active.provisional ? 'warning' : 'success'}>{active.provisional ? '暂定 Rating' : '正式 Rating'}</StatusBadge></div>}
        {active && <AsyncRegion state={historyResource.state} onRetry={historyResource.retry} emptyText="该账户暂无比赛记录" skeletonRows={4}>
          {history => <div className={styles.historyLayout}>
            <div><div className={styles.metricRow}><span><TrendingUp size={16} />当前 <strong>{active.rating}</strong></span><span><Award size={16} />峰值 <strong>{active.peakRating}</strong></span><span><History size={16} />比赛 <strong>{active.ratedContestCount}</strong></span></div><RatingCurve items={history.data} /></div>
            <div className={styles.historyList}>{history.data.map(item => <Link href={`/personal/contests/${item.contest.id}`} className={styles.historyItem} key={item.id}><span><strong>{item.contest.title}</strong><small>第 {item.rank}/{item.fieldSize} 名 · {new Date(item.contest.endTime).toLocaleDateString('zh-CN')}</small></span><span className={item.appliedDelta >= 0 ? styles.positive : styles.negative}>{item.appliedDelta >= 0 ? '+' : ''}{item.appliedDelta}<small>{item.ratingBefore} → {item.ratingAfter}</small></span></Link>)}</div>
          </div>}
        </AsyncRegion>}
      </div>}
    </AsyncRegion>
  </Section>
}
