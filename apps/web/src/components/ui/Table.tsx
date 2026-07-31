'use client'

import React from 'react'
import { tableStyles } from '@/lib/styles'
import { Empty } from './Empty'
import { LoadError } from './LoadError'
import { SkeletonRegion } from './AsyncRegion'

// 辅助函数：根据 key 路径获取嵌套对象的值
function get(obj: any, path: string): any {
  const keys = path.split('.')
  let result = obj
  for (const key of keys) {
    if (result === null || result === undefined) return undefined
    result = result[key]
  }
  return result
}

export interface Column<T> {
  key: string
  label: string
  width?: string
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
  actions?: (item: T) => React.ReactNode
  onRowClick?: (item: T) => void
  rowKey?: (item: T) => string
}

export function Table<T extends { id?: string }>({
  data,
  columns,
  loading,
  error,
  onRetry,
  refreshing,
  emptyText = '暂无数据',
  actions,
  onRowClick,
  rowKey,
}: TableProps<T>) {
  if (loading) {
    return <SkeletonRegion rows={5} label="表格内容正在准备" />
  }

  if (error) {
    return <LoadError message={error} onRetry={onRetry || (() => window.location.reload())} />
  }

  if (data.length === 0) {
    return <Empty text={emptyText} />
  }

  const getKey = (item: T, index: number): string => {
    if (rowKey) return rowKey(item)
    if (item.id) return String(item.id)
    return String(index)
  }

  return (
    <div style={{ ...tableStyles.container, opacity: refreshing ? 0.72 : 1 }}>
      <table style={tableStyles.table}>
        <thead style={tableStyles.thead}>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ ...tableStyles.th, width: col.width }}>
                {col.label}
              </th>
            ))}
            {actions && <th style={{ ...tableStyles.th, width: '120px' }}>操作</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((item, rowIndex) => (
            <tr
              key={getKey(item, rowIndex)}
              onClick={() => onRowClick?.(item)}
              style={{
                cursor: onRowClick ? 'pointer' : 'default',
              }}
              className="table-row"
            >
              {columns.map((col) => (
                <td key={col.key} style={tableStyles.td}>
                  {col.render ? col.render(item, rowIndex) : get(item, col.key)}
                </td>
              ))}
              {actions && (
                <td style={{ ...tableStyles.td, borderBottom: '1px solid var(--border)' }} onClick={(e) => e.stopPropagation()}>
                  {actions(item)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <style jsx>{`
        .table-row:hover {
          background: var(--bg-hover);
        }
      `}</style>
    </div>
  )
}
