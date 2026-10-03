'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, Home, RefreshCw } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { Button } from '@/components/ui/Button'
import { navigationHome, resolveNavigationContext } from '@/lib/navigationContext'
import styles from './ContextualRecovery.module.css'

type ContextualRecoveryProps = {
  status?: '403' | '404' | 'error'
  title: string
  description: string
  requestId?: string
  onRetry?: () => void
}

function recoveryStatusLabel(status: ContextualRecoveryProps['status']) {
  if (status === '403') return '无法访问'
  if (status === '404') return '内容不存在'
  return '暂时无法显示'
}

function homeLabel(workspace: 'organization' | 'personal' | 'platform', organizationName?: string | null) {
  if (workspace === 'organization') return `返回${organizationName || '学校'}首页`
  if (workspace === 'platform') return '返回平台管理'
  return '返回个人首页'
}

export function ContextualRecovery({ status, title, description, requestId, onRetry }: ContextualRecoveryProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  const context = resolveNavigationContext(pathname, user)

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="contextual-recovery-title">
        {status && <p className={styles.status}>{recoveryStatusLabel(status)}</p>}
        <h1 id="contextual-recovery-title">{title}</h1>
        <p className={styles.description}>{description}</p>
        {requestId && <details className={styles.requestId}><summary>诊断信息</summary><code>请求编号：{requestId}</code></details>}
        <div className={styles.actions}>
          {onRetry && <Button type="button" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" />重新加载</Button>}
          <Button type="button" variant="secondary" onClick={() => router.back()}><ArrowLeft size={16} aria-hidden="true" />返回上一页</Button>
          <Link className={styles.homeLink} href={navigationHome(context)}><Home size={16} aria-hidden="true" />{homeLabel(context.workspace, user?.organizationName)}</Link>
        </div>
      </section>
    </main>
  )
}
