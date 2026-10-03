import type { BadgeVariant } from '@/components/ui/Badge'

export type QualityStatus = 'READY' | 'NOT_READY' | 'CRITICAL' | 'STALE'

export function effectiveQualityStatus(status: QualityStatus, isStale?: boolean): QualityStatus {
  return isStale ? 'STALE' : status
}

export function qualityStatusPresentation(status: QualityStatus, isStale?: boolean): { label: string; variant: BadgeVariant; description: string } {
  const effective = effectiveQualityStatus(status, isStale)
  if (effective === 'READY') return { label: '可用', variant: 'success', description: '数据质量检查已通过。' }
  if (effective === 'CRITICAL') return { label: '严重问题', variant: 'error', description: '发现影响评测正确性的严重问题。' }
  if (effective === 'STALE') return { label: '已过期', variant: 'warning', description: '评估依据已变化，需要重新进行质量检查。' }
  return { label: '未就绪', variant: 'warning', description: '当前缺少完成质量检查所需的评测配置或验证数据。' }
}

export function qualityJobPresentation(status: string): { label: string; variant: BadgeVariant } {
  if (status === 'SUCCEEDED') return { label: '已完成', variant: 'success' }
  if (status === 'FAILED') return { label: '失败', variant: 'error' }
  if (status === 'RUNNING') return { label: '评估中', variant: 'pending' }
  if (status === 'CANCELLED') return { label: '已取消', variant: 'neutral' }
  return { label: '排队中', variant: 'pending' }
}

export function displayScore(score: number | null | undefined) {
  return score == null ? '—' : String(score)
}
