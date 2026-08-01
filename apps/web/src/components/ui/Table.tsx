'use client'

import React from 'react'
import { Empty } from './Empty'
import { LoadError } from './LoadError'
import { SkeletonRegion } from './AsyncRegion'
import styles from './primitives.module.css'

function get(obj: unknown, path: string): unknown {
  const keys = path.split('.')
  let result = obj
  for (const key of keys) {
    if (result === null || result === undefined || typeof result !== 'object') return undefined
    result = (result as Record<string, unknown>)[key]
  }
  return result
}

export interface Column<T> {
  key: string
  label: string
  width?: string
  align?: 'left' | 'center' | 'right'
  render?: (item: T, index: number) => React.ReactNode
}

export interface TableProps<T> {
  data: T[]
  columns: Column<T>[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  refreshing?: boolean
  emptyText?: string
  emptyDescription?: string
  actions?: (item: T) => React.ReactNode
  onRowClick?: (item: T) => void
  rowKey?: (item: T) => string
  caption?: string
  isCurrentRow?: (item: T) => boolean
}

export function Table<T extends { id?: string | number }>({
  data,
  columns,
  loading,
  error,
  onRetry,
  refreshing,
  emptyText = '暂无数据',
  emptyDescription,
  actions,
  onRowClick,
  rowKey,
  caption,
  isCurrentRow,
}: TableProps<T>) {
  if (loading) return <SkeletonRegion rows={5} label="表格内容正在准备" />
  if (error) return <LoadError message={error} onRetry={onRetry || (() => window.location.reload())} />
  if (data.length === 0) return <Empty title={emptyText} description={emptyDescription} />

  const getKey = (item: T, index: number) => String(rowKey?.(item) || item.id || index)
  const activateRow = (event: React.KeyboardEvent<HTMLTableRowElement>, item: T) => {
    if (!onRowClick || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onRowClick(item)
  }

  return (
    <div className={`${styles.tableShell} ${refreshing ? styles.tableRefreshing : ''}`} aria-busy={refreshing || undefined}>
      <table className={styles.table}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.key} style={{ width: column.width, textAlign: column.align }} scope="col">
                {column.label}
              </th>
            ))}
            {actions && <th style={{ width: 136, textAlign: 'right' }} scope="col">操作</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((item, rowIndex) => (
            <tr
              key={getKey(item, rowIndex)}
              className={`${styles.tableRow} ${isCurrentRow?.(item) ? styles.tableRowCurrent : ''}`.trim()}
              data-clickable={Boolean(onRowClick)}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={() => onRowClick?.(item)}
              onKeyDown={event => activateRow(event, item)}
            >
              {columns.map(column => (
                <td key={column.key} style={{ textAlign: column.align }}>
                  {column.render ? column.render(item, rowIndex) : String(get(item, column.key) ?? '')}
                </td>
              ))}
              {actions && (
                <td onClick={event => event.stopPropagation()}>
                  <div className={styles.tableActions}>{actions(item)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
