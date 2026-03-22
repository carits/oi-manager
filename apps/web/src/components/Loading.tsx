export function Loading({ tip = '加载中...' }: { tip?: string }) {
  return (
    <div style={{
      minHeight: '200px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1rem'
    }}>
      <div style={{
        width: '40px',
        height: '40px',
        border: '3px solid var(--gray-200)',
        borderTopColor: 'var(--primary)',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      }} />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <p style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>{tip}</p>
    </div>
  )
}

export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{
      padding: '2rem',
      textAlign: 'center',
      color: 'var(--error)'
    }}>
      <p style={{ marginBottom: onRetry ? '1rem' : 0 }}>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '0.5rem 1rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            background: 'white',
            fontSize: '0.875rem'
          }}
        >
          重试
        </button>
      )}
    </div>
  )
}

export function Empty({ message = '暂无数据' }: { message?: string }) {
  return (
    <div style={{
      padding: '3rem',
      textAlign: 'center',
      color: 'var(--gray-500)'
    }}>
      {message}
    </div>
  )
}
