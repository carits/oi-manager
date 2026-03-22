import React from 'react'
import { badgeStyles } from '@/lib/styles'

export interface BadgeProps {
  variant?: 'success' | 'error' | 'warning' | 'info'
  children: React.ReactNode
  style?: React.CSSProperties
}

export function Badge({ variant = 'info', children, style }: BadgeProps) {
  return (
    <span style={{ ...badgeStyles.base, ...badgeStyles[variant], ...style }}>
      {children}
    </span>
  )
}
