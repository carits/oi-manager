import React from 'react'
import styles from './primitives.module.css'

export type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'pending'

export interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  style?: React.CSSProperties
  dot?: boolean
}

const variantClasses: Record<BadgeVariant, string> = {
  success: styles.badgeSuccess,
  error: styles.badgeError,
  warning: styles.badgeWarning,
  info: styles.badgeInfo,
  neutral: styles.badgeNeutral,
  pending: styles.badgePending,
}

export function Badge({ variant = 'info', children, style, dot }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${variantClasses[variant]}`} style={style}>
      {dot && <span className={styles.badgeDot} aria-hidden="true" />}
      {children}
    </span>
  )
}

export const StatusBadge = Badge

export function getResultVariant(result: string): BadgeVariant {
  if (!result) return 'neutral'
  const normalized = result.toLowerCase()
  if (normalized === 'accepted') return 'success'
  if (['wrong_answer', 'wa', 'wrong answer'].includes(normalized)) return 'error'
  if (['time_limit_exceeded', 'tle', 'time limit', 'memory_limit_exceeded', 'mle', 'memory limit', 'output_limit_exceeded', 'ole', 'output limit', 'unaccepted', 'partial', 'partial accepted'].includes(normalized)) return 'warning'
  if (['runtime_error', 're', 'runtime error', 'compilation_error', 'ce', 'compile error', 'compile_error', 'system_error', 'se', 'system error'].includes(normalized)) return 'error'
  if (['pending', 'queuing', 'judging', 'waiting', 'pending_review'].includes(normalized)) return 'pending'
  return 'neutral'
}
