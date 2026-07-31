'use client'

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
        <main style={{ maxWidth: '720px', margin: '0 auto', padding: '3rem 1.5rem', fontFamily: 'sans-serif' }}>
          <h1 style={{ margin: '0 0 0.75rem', fontSize: '1.5rem' }}>服务暂时不可用</h1>
          <p style={{ color: '#4b5563' }}>应用外壳遇到了异常，请重试。你的登录状态不会因此被清除。</p>
          {error.digest && <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>请求编号：{error.digest}</p>}
          <button
            type="button"
            onClick={reset}
            style={{ padding: '0.625rem 1rem', border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
          >
            重试
          </button>
        </main>
      </body>
    </html>
  )
}
