import React from 'react'
import { cardStyles } from '@/lib/styles'

export interface CardProps {
  title?: string
  children: React.ReactNode
  style?: React.CSSProperties
}

export function Card({ title, children, style }: CardProps) {
  return (
    <div style={{ ...cardStyles.base, ...style }}>
      {title && (
        <div style={cardStyles.header}>
          <h3 style={cardStyles.title}>{title}</h3>
        </div>
      )}
      {children}
    </div>
  )
}
