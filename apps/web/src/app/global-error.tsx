'use client'
import { Button } from '@/components/ui/Button'
import unifiedStyles from './global-error.unified.module.css'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="zh-CN">
      <body>
        <main className={unifiedStyles.u1}>
          <h1 className={unifiedStyles.u2}>服务暂时不可用</h1>
          <p className={unifiedStyles.u3}>应用外壳遇到了异常，请重试。你的登录状态不会因此被清除。</p>
          {error.digest && <p className={unifiedStyles.u4}>请求编号：{error.digest}</p>}
          <Button variant="ghost"
            type="button"
            onClick={reset}
            className={unifiedStyles.u5}
          >
            重试
          </Button>
        </main>
      </body>
    </html>
  )
}
