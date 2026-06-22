import React from 'react'
import { badgeStyles } from '@/lib/styles'

export type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'pending'

export interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  style?: React.CSSProperties
  dot?: boolean
}

const dotColors: Record<BadgeVariant, string> = {
  success: 'var(--success)',
  error: 'var(--error)',
  warning: 'var(--warning)',
  info: 'var(--info)',
  neutral: 'var(--text-muted)',
  pending: 'var(--warning)',
}

export function Badge({ variant = 'info', children, style, dot }: BadgeProps) {
  return (
    <span style={{ ...badgeStyles.base, ...badgeStyles[variant], ...style, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColors[variant], flexShrink: 0 }} />}
      {children}
    </span>
  )
}

// 评测结果专用 Badge 映射
export function getResultVariant(result: string): BadgeVariant {
  if (!result) return 'neutral'
  const r = result.toLowerCase()
  if (r === 'accepted') return 'success'
  if (['wrong_answer', 'wa', 'wrong answer'].includes(r)) return 'error'
  if (['time_limit_exceeded', 'tle', 'time limit'].includes(r)) return 'warning'
  if (['memory_limit_exceeded', 'mle', 'memory limit'].includes(r)) return 'warning'
  if (['runtime_error', 're', 'runtime error'].includes(r)) return 'error'
  if (['compilation_error', 'ce', 'compile error', 'compile_error'].includes(r)) return 'error'
  if (['system_error', 'se', 'system error'].includes(r)) return 'error'
  if (['output_limit_exceeded', 'ole', 'output limit'].includes(r)) return 'warning'
  if (['pending', 'queuing', 'judging', 'waiting'].includes(r)) return 'pending'
  if (['unaccepted', 'partial', 'partial accepted'].includes(r)) return 'warning'
  if (r === 'pending_review') return 'pending'
  return 'neutral'
}
