import type { BadgeVariant } from '@/components/ui/Badge'

export type QualityStatus = 'READY' | 'NOT_READY' | 'CRITICAL' | 'STALE'

export function effectiveQualityStatus(status: QualityStatus, isStale?: boolean): QualityStatus {
  return isStale ? 'STALE' : status
}

export function qualityStatusPresentation(status: QualityStatus, isStale?: boolean): { label: string; variant: BadgeVariant; description: string } {
  const effective = effectiveQualityStatus(status, isStale)
  if (effective === 'READY') return { label: '可用', variant: 'success', description: '正确性硬门槛已通过，可解读 DQS。' }
  if (effective === 'CRITICAL') return { label: '严重问题', variant: 'error', description: '命中正确性 Critical Gate，DQS 不可用。' }
  if (effective === 'STALE') return { label: '已过期', variant: 'warning', description: '评估输入已变化，历史快照保留但需重新评估。' }
  return { label: '未就绪', variant: 'warning', description: '缺少 STD、Validator、Checker、完整 Revision 或可用 Evaluation/Holdout，DQS 不可用。' }
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
