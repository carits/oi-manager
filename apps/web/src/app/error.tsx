'use client'

import { useEffect } from 'react'
import { ContextualRecovery } from '@/components/navigation/ContextualRecovery'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Route render failed', error)
  }, [error])

  return <ContextualRecovery status="error" title="页面暂时无法显示" description="你可以重新加载当前页面，或返回当前工作区继续操作。" requestId={error.digest} onRetry={reset} />
}
