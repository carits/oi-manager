import { SkeletonRegion } from './ui/AsyncRegion'

export function Loading({ tip = '内容正在准备' }: { tip?: string }) {
  return <SkeletonRegion rows={5} label={tip} />
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
