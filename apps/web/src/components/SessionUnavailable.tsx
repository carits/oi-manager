export function SessionUnavailable({
  message,
  requestId,
}: {
  message: string
  requestId?: string
}) {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: '2rem',
      background: 'var(--bg-page)',
    }}>
      <section role="alert" style={{ maxWidth: '32rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>暂时无法确认登录状态</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>{message}</p>
        {requestId && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '1rem' }}>
            请求编号：{requestId}
          </p>
        )}
        <a
          href=""
          style={{
            display: 'inline-block',
            padding: '0.55rem 1rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--text-primary)',
            background: 'var(--bg-card)',
            textDecoration: 'none',
          }}
        >
          重试
        </a>
      </section>
    </main>
  )
}
