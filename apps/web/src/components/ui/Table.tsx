import React from 'react'
import { tableStyles } from '@/lib/styles'
import { Empty } from './Empty'

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
  emptyText?: string
  actions?: (item: T) => React.ReactNode
  onRowClick?: (item: T) => void
}

export function Table<T extends { id: string }>({
  data,
  columns,
  loading,
  emptyText = '暂无数据',
  actions,
  onRowClick
}: TableProps<T>) {
  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>
        加载中...
      </div>
    )
  }

  if (data.length === 0) {
    return <Empty text={emptyText} />
  }

  return (
    <div style={tableStyles.container}>
      <table style={tableStyles.table}>
        <thead style={tableStyles.thead}>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={{ ...tableStyles.th, width: col.width }}>
                {col.label}
              </th>
            ))}
            {actions && <th style={tableStyles.th}>操作</th>}
          </tr>
        </thead>
        <tbody>
          {data.map((item, rowIndex) => (
            <tr
              key={item.id}
              onClick={() => onRowClick?.(item)}
              style={{
                ...tableStyles.row,
                cursor: onRowClick ? 'pointer' : 'default'
              }}
              onMouseEnter={(e) => {
                if (onRowClick) {
                  e.currentTarget.style.background = 'var(--gray-50)'
                }
              }}
              onMouseLeave={(e) => {
                if (onRowClick) {
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              {columns.map((col) => (
                <td key={col.key} style={tableStyles.td}>
                  {col.render ? col.render(item, rowIndex) : get(item, col.key)}
                </td>
              ))}
              {actions && (
                <td style={tableStyles.td} onClick={(e) => e.stopPropagation()}>
                  {actions(item)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
