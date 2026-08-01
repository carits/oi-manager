import type { HTMLAttributes, ReactNode } from 'react'
import styles from './primitives.module.css'

export interface PageFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  width?: 'default' | 'reading' | 'form' | 'workbench'
}

export function PageFrame({
  children,
  width = 'default',
  className = '',
  ...props
}: PageFrameProps) {
  return (
    <div
      className={`${styles.pageFrame} ${className}`.trim()}
      data-width={width}
      {...props}
    >
      {children}
    </div>
  )
}
