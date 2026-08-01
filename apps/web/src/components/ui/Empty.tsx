import React from 'react'
import { Inbox } from 'lucide-react'
import styles from './primitives.module.css'

export interface EmptyProps {
  text?: string
  title?: string
  description?: string
  icon?: React.ReactNode
  action?: React.ReactNode
}

export function Empty({
  text,
  title,
  description,
  icon,
  action,
}: EmptyProps) {
  const resolvedTitle = title || text || '暂无数据'

  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon} aria-hidden="true">{icon || <Inbox size={32} />}</div>
      <p className={styles.emptyTitle}>{resolvedTitle}</p>
      {description && <p className={styles.emptyDescription}>{description}</p>}
      {action}
    </div>
  )
}

export const EmptyState = Empty
