'use client'

import { useEffect, useState } from 'react'
import { CircleDollarSign, ReceiptText } from 'lucide-react'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { apiClient } from '@/lib/apiClient'
import styles from './WalletPage.module.css'

interface WalletEntry {
  id: string
  type: string
  source: string
  amount: string
  balanceAfter: string
  createdAt: string
}

interface WalletData {
  currency: string
  accountStatus: 'active' | 'empty'
  balance?: string
  items: WalletEntry[]
}

export function WalletPage({ scope, endpoint }: { scope: 'personal' | 'organization'; endpoint: string }) {
  const [data, setData] = useState<WalletData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void apiClient.get<WalletData>(endpoint).then(result => {
      if (!active) return
      if (result.success && result.data) setData(result.data)
      else setError(result.message || '钱包信息加载失败')
    })
    return () => { active = false }
  }, [endpoint])

  const entries = data?.items || []
  return (
    <PageFrame width="reading">
      <PageHeader title={scope === 'personal' ? '我的钱包' : '校园资产'} description={scope === 'personal' ? '查看个人 Carits币资产及其来源。' : '查看当前校园的 Carits币资产与消费记录。'} />
      <section className={styles.wallet} aria-label="Carits币钱包">
        <div className={styles.summary}>
          <span className={styles.icon}><CircleDollarSign size={24} aria-hidden="true" /></span>
          <div><span className={styles.currency}>Carits币</span>{data?.accountStatus === 'active' && <strong>{data.balance}</strong>}</div>
        </div>
        {error ? <p className={styles.error}>{error}</p> : data?.accountStatus === 'empty' ? <p className={styles.empty}>暂无资产记录</p> : entries.length === 0 ? <p className={styles.empty}>暂无消费记录</p> : (
          <div className={styles.records}>
            <div className={styles.recordsHeader}><ReceiptText size={17} aria-hidden="true" /><h2>资产记录</h2></div>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th>时间</th><th>类型</th><th>来源/用途</th><th>变动</th><th>余额变化</th></tr></thead>
                <tbody>{entries.map(item => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('zh-CN')}</td><td>{item.type}</td><td>{item.source}</td><td>{item.amount}</td><td>{item.balanceAfter}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </PageFrame>
  )
}
