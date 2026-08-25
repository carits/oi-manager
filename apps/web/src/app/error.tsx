'use client'

import { useRouter } from 'next/navigation'
import unifiedStyles from './error.unified.module.css'
import { useEffect } from 'react'
import { LoadError } from '@/components/ui/LoadError'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error('Route render failed', error)
  }, [error])

  return (
    <main className={unifiedStyles.u1}>
      <h1 className={unifiedStyles.u2}>页面暂时无法显示</h1>
      <p className={unifiedStyles.u3}>
        页面结构仍然可用，你可以重试本次渲染或返回首页。
      </p>
      <LoadError
        message="页面渲染发生异常"
        requestId={error.digest}
        onRetry={reset}
        onBack={() => router.push('/')}
      />
    </main>
  )
}
