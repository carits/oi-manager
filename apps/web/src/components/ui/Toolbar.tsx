import type { HTMLAttributes, ReactNode } from 'react'
import styles from './primitives.module.css'

export function Toolbar({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={`${styles.toolbar} ${className}`.trim()} {...props}>{children}</div>
}

export function ToolbarGroup({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div className={`${styles.toolbarGroup} ${className}`.trim()} {...props}>{children}</div>
}
