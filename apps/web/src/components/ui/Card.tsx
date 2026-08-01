import React from 'react'
import styles from './primitives.module.css'

export interface CardProps {
  title?: string
  subtitle?: string
  children: React.ReactNode
  style?: React.CSSProperties
  className?: string
  hoverable?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg'
  onClick?: () => void
}

export function Card({
  title,
  subtitle,
  children,
  style,
  className = '',
  hoverable = false,
  padding = 'md',
  onClick,
}: CardProps) {
  return (
    <div
      className={`${styles.card} ${className}`.trim()}
      data-padding={padding}
      data-hoverable={hoverable}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      } : undefined}
    >
      {title && (
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>{title}</h2>
          {subtitle && <p className={styles.cardSubtitle}>{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  )
}
