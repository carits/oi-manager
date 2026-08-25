'use client'

import { useEffect, useState } from 'react'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
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

export function WalletPage({ scope, endpoint, embedded = false }: { scope: 'personal' | 'organization'; endpoint: string; embedded?: boolean }) {
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
  const content = <section className={styles.wallet} aria-label="Carits币钱包">
        <div className={styles.summary}>
          <span className={styles.icon}><CircleDollarSign size={24} aria-hidden="true" /></span>
          <div><span className={styles.currency}>Carits币</span>{data?.accountStatus === 'active' && <strong>{data.balance}</strong>}</div>
        </div>
        {error ? <p className={styles.error}>{error}</p> : data?.accountStatus === 'empty' ? <p className={styles.empty}>暂无资产记录</p> : entries.length === 0 ? <p className={styles.empty}>暂无消费记录</p> : (
          <div className={styles.records}>
            <div className={styles.recordsHeader}><ReceiptText size={17} aria-hidden="true" /><h2>资产记录</h2></div>
            <div className={styles.tableWrap}>
              <TableRoot>
                <TableHead><TableRow><TableHeaderCell>时间</TableHeaderCell><TableHeaderCell>类型</TableHeaderCell><TableHeaderCell>来源/用途</TableHeaderCell><TableHeaderCell>变动</TableHeaderCell><TableHeaderCell>余额变化</TableHeaderCell></TableRow></TableHead>
                <TableBody>{entries.map(item => <TableRow key={item.id}><TableCell>{new Date(item.createdAt).toLocaleString('zh-CN')}</TableCell><TableCell>{item.type}</TableCell><TableCell>{item.source}</TableCell><TableCell>{item.amount}</TableCell><TableCell>{item.balanceAfter}</TableCell></TableRow>)}</TableBody>
              </TableRoot>
            </div>
          </div>
        )}
      </section>
  return embedded ? content : <PageFrame width="reading"><PageHeader title={scope === 'personal' ? '我的钱包' : '校园资产'} description={scope === 'personal' ? '查看个人 Carits币资产及其来源。' : '查看当前校园的 Carits币资产与消费记录。'} />{content}</PageFrame>
}
