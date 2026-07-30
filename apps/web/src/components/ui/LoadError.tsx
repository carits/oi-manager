interface LoadErrorProps {
  message?: string
  onRetry: () => void
}

export function LoadError({
  message = '数据加载失败，请稍后重试',
  onRetry,
}: LoadErrorProps) {
  return (
    <div
      role="alert"
      style={{
        padding: '3rem',
        textAlign: 'center',
        color: 'var(--error)',
      }}
    >
      <p style={{ marginBottom: '1rem' }}>{message}</p>
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
        重新加载
      </button>
    </div>
  )
}
