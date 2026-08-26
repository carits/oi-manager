import { SkeletonRegion } from './ui/AsyncRegion'
import unifiedStyles from './Loading.unified.module.css'
import { Button } from '@/components/ui/Button'

export function Loading({ tip = '内容正在准备' }: { tip?: string }) {
  return <SkeletonRegion rows={5} label={tip} />
}

export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={unifiedStyles.u1}>
      <p className={onRetry ? unifiedStyles.messageWithAction : unifiedStyles.message}>{message}</p>
      {onRetry && (
        <Button variant="ghost"
          onClick={onRetry}
          className={unifiedStyles.u2}
        >
          重试
        </Button>
      )}
    </div>
  )
}

export function Empty({ message = '暂无数据' }: { message?: string }) {
  return (
    <div className={unifiedStyles.u3}>
      {message}
    </div>
  )
}
