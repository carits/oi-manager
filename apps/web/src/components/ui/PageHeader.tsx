import React from 'react'
import { layoutStyles } from '@/lib/styles'

export interface PageHeaderProps {
  title: string
  description?: string
  children?: React.ReactNode
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div style={layoutStyles.header}>
      <div>
        <h2 style={layoutStyles.title}>{title}</h2>
        {description && (
          <p style={{ margin: '0.5rem 0 0 0', color: 'var(--gray-600)', fontSize: '0.875rem' }}>
            {description}
          </p>
        )}
      </div>
      {children && <div>{children}</div>}
    </div>
  )
}
