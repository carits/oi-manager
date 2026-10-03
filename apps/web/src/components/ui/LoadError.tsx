interface LoadErrorProps {
  title?: string
  message?: string
  requestId?: string
  compact?: boolean
  onRetry: () => void
  onBack?: () => void
}

export function LoadError({
  title = '暂时无法显示内容',
  message = '数据加载失败，请稍后重试',
  requestId,
  compact = false,
  onRetry,
  onBack,
}: LoadErrorProps) {
  return (
    <div
      role="alert"
      style={{
        padding: compact ? '0.75rem 1rem' : '3rem',
        textAlign: 'center',
        color: 'var(--error)',
      }}
    >
      <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-primary)', fontSize: 'var(--text-lg)' }}>
        {title}
      </h2>
      <p style={{ marginBottom: '1rem' }}>{message}</p>
      {requestId && (
        <details style={{ margin: '-0.5rem 0 1rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
          <summary style={{ cursor: 'pointer' }}>诊断信息</summary>
          <code>请求编号：{requestId}</code>
        </details>
      )}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
        <button
          type="button"
          onClick={onRetry}
          style={{
            padding: '0.5rem 1rem',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          重试
        </button>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{
              padding: '0.5rem 1rem',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            返回
          </button>
        )}
      </div>
    </div>
  )
}
