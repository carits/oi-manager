'use client'

import { useState, CSSProperties } from 'react'

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

export function Pagination({
  currentPage,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  showQuickJumper = true,
  showTotal = true
}: PaginationProps) {
  const [jumpValue, setJumpValue] = useState('')

  // 计算要显示的页码
  const getPageNumbers = (): (number | 'ellipsis')[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1)
    }

    const pages: (number | 'ellipsis')[] = [1]

    if (currentPage > 3) {
      pages.push('ellipsis')
    }

    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i)
    }

    if (currentPage < totalPages - 2) {
      pages.push('ellipsis')
    }

    if (totalPages > 1) {
      pages.push(totalPages)
    }

    return pages
  }

  const handleJump = () => {
    const page = parseInt(jumpValue)
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      onPageChange(page)
      setJumpValue('')
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleJump()
    }
  }

  const containerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem',
    background: 'white',
    borderTop: '1px solid var(--border)'
  }

  const leftSectionStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  }

  const pageListStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  }

  const pageButtonStyle: CSSProperties = {
    minWidth: '2rem',
    height: '2rem',
    padding: '0 0.5rem',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    background: 'white',
    cursor: 'pointer',
    fontSize: '0.875rem',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }

  const pageButtonActiveStyle: CSSProperties = {
    ...pageButtonStyle,
    background: 'var(--primary)',
    color: 'white',
    borderColor: 'var(--primary)',
    fontWeight: 500
  }

  const pageButtonDisabledStyle: CSSProperties = {
    ...pageButtonStyle,
    opacity: 0.5,
    cursor: 'not-allowed'
  }

  const ellipsisStyle: CSSProperties = {
    padding: '0 0.5rem',
    color: 'var(--gray-500)'
  }

  const selectStyle: CSSProperties = {
    padding: '0.25rem 0.5rem',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    fontSize: '0.875rem',
    cursor: 'pointer'
  }

  const inputStyle: CSSProperties = {
    width: '3rem',
    padding: '0.25rem 0.5rem',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    fontSize: '0.875rem',
    textAlign: 'center'
  }

  const jumpButtonStyle: CSSProperties = {
    padding: '0.25rem 0.75rem',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    background: 'white',
    cursor: 'pointer',
    fontSize: '0.875rem',
    transition: 'all 0.2s'
  }

  const totalTextStyle: CSSProperties = {
    fontSize: '0.875rem',
    color: 'var(--gray-600)'
  }

  const pageNumbers = getPageNumbers()

  return (
    <div style={containerStyle}>
      <div style={leftSectionStyle}>
        {showTotal && (
          <span style={totalTextStyle}>
            共 {total} 条
          </span>
        )}

        {onPageSizeChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>每页</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              style={selectStyle}
            >
              {pageSizeOptions.map(size => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <span style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>条</span>
          </div>
        )}
      </div>

      <div style={pageListStyle}>
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          style={currentPage === 1 ? pageButtonDisabledStyle : pageButtonStyle}
        >
          上一页
        </button>

        {pageNumbers.map((page, index) => {
          if (page === 'ellipsis') {
            return <span key={`ellipsis-${index}`} style={ellipsisStyle}>...</span>
          }

          return (
            <button
              key={page}
              onClick={() => onPageChange(page)}
              style={page === currentPage ? pageButtonActiveStyle : pageButtonStyle}
            >
              {page}
            </button>
          )
        })}

        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          style={currentPage === totalPages ? pageButtonDisabledStyle : pageButtonStyle}
        >
          下一页
        </button>

        {showQuickJumper && totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '0.5rem' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>跳至</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              onKeyPress={handleKeyPress}
              style={inputStyle}
              placeholder="页"
            />
            <button onClick={handleJump} style={jumpButtonStyle}>
              跳转
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
