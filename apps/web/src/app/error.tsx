'use client'

import { useRouter } from 'next/navigation'
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
    <main style={{ maxWidth: '720px', margin: '0 auto', padding: '3rem 1.5rem' }}>
      <h1 style={{ margin: '0 0 0.75rem', fontSize: '1.5rem' }}>页面暂时无法显示</h1>
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
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
