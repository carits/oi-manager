import React from 'react'
import { cardStyles } from '@/lib/styles'

export interface CardProps {
  title?: string
  subtitle?: string
  children: React.ReactNode
  style?: React.CSSProperties
  hoverable?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  onClick?: () => void
}

export function Card({ title, subtitle, children, style, hoverable, padding = 'md', onClick }: CardProps) {
  const paddingMap: Record<string, string> = {
    none: '0',
    sm: '1rem',
    md: '1.5rem',
    lg: '2rem',
  }

  const base = hoverable ? cardStyles.hoverable : cardStyles.base

  return (
    <div
      style={{
        ...base,
        padding: paddingMap[padding],
        ...(onClick ? { cursor: 'pointer' } : {}),
        ...style,
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (hoverable) {
          e.currentTarget.style.boxShadow = 'var(--shadow-md)'
          e.currentTarget.style.borderColor = 'var(--border-hover)'
        }
      }}
      onMouseLeave={(e) => {
        if (hoverable) {
          e.currentTarget.style.boxShadow = 'none'
          e.currentTarget.style.borderColor = 'var(--border)'
        }
      }}
    >
      {title && (
        <div style={cardStyles.header}>
          <h3 style={cardStyles.title}>{title}</h3>
          {subtitle && (
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>{subtitle}</p>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
