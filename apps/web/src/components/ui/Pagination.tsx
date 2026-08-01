'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './primitives.module.css'

interface PaginationProps {
  currentPage: number
  totalPages: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  showQuickJumper?: boolean
  showTotal?: boolean
}

function getPageItems(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)

  const pages = [1, total, current - 1, current, current + 1]
  const sorted = pages
    .filter((page, index) => page >= 1 && page <= total && pages.indexOf(page) === index)
    .sort((a, b) => a - b)
  const result: Array<number | 'ellipsis'> = []

  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push('ellipsis')
    result.push(page)
  })

  return result
}

export function Pagination({
  currentPage,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  showQuickJumper = true,
  showTotal = true,
}: PaginationProps) {
  const [jumpPage, setJumpPage] = useState('')
  if (totalPages <= 1 && !onPageSizeChange) return null

  const jump = () => {
    const parsed = Number.parseInt(jumpPage, 10)
    if (!Number.isNaN(parsed)) onPageChange(Math.min(totalPages, Math.max(1, parsed)))
    setJumpPage('')
  }

  return (
    <nav className={styles.pagination} aria-label="分页导航">
      <div>
        {showTotal && <span>共 {total} 条</span>}
        {onPageSizeChange && (
          <select
            className={styles.pageSelect}
            value={pageSize}
            onChange={event => onPageSizeChange(Number(event.target.value))}
            aria-label="每页条数"
            style={{ marginLeft: showTotal ? 12 : 0 }}
          >
            {pageSizeOptions.map(option => <option key={option} value={option}>{option} 条/页</option>)}
          </select>
        )}
      </div>

      <div className={styles.paginationControls}>
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="上一页"
          title="上一页"
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        {getPageItems(currentPage, totalPages).map((item, index) => item === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} aria-hidden="true">…</span>
        ) : (
          <button
            type="button"
            key={item}
            className={styles.pageButton}
            aria-current={item === currentPage ? 'page' : undefined}
            onClick={() => onPageChange(item)}
          >
            {item}
          </button>
        ))}
        <button
          type="button"
          className={styles.pageButton}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="下一页"
          title="下一页"
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        {showQuickJumper && totalPages > 7 && (
          <input
            className={styles.pageJumpInput}
            type="number"
            min={1}
            max={totalPages}
            value={jumpPage}
            onChange={event => setJumpPage(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') jump() }}
            onBlur={jump}
            placeholder="页码"
            aria-label="跳转页码"
          />
        )}
      </div>
    </nav>
  )
}
