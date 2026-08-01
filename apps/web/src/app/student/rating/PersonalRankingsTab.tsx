'use client'

import { useCallback, useEffect, useState } from 'react'
import { Table } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import apiClient, { ApiResponse } from '@/lib/apiClient'
import { useAuth } from '@/components/AuthProvider'

type RankingType = 'rating' | 'solved'

interface PersonalRankingRow {
  id: string
  username: string
  rating?: number
  solvedCount?: number
}

interface PersonalRankingsTabProps {
  type: RankingType
}

type PagedResponse = ApiResponse<PersonalRankingRow[]> & {
  page?: number
  pageSize?: number
  total?: number
  totalPages?: number
}

export default function PersonalRankingsTab({ type }: PersonalRankingsTabProps) {
  const { user } = useAuth()
  const [rows, setRows] = useState<PersonalRankingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const fetchRankings = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    const endpoint = type === 'rating' ? 'rating' : 'solved'
    const result = await apiClient.get<PersonalRankingRow[]>(
      `/api/rankings/personal/${endpoint}?page=${page}&pageSize=${pageSize}`,
      { signal }
    ) as PagedResponse

    if (!result.success) {
      setRows([])
      setError(result.message || '排名获取失败')
      setLoading(false)
      return
    }

    setRows(result.data || [])
    setTotal(result.total || 0)
    setTotalPages(result.totalPages || 1)
    setLoading(false)
  }, [page, pageSize, type])

  useEffect(() => {
    const controller = new AbortController()
    void fetchRankings(controller.signal)
    return () => controller.abort()
  }, [fetchRankings])

  useEffect(() => {
    setPage(1)
  }, [type])

  const valueKey = type === 'rating' ? 'rating' : 'solvedCount'
  const valueLabel = type === 'rating' ? 'Rating' : '做题量'
  const startIndex = (page - 1) * pageSize

  return (
    <div>
      <Table
        data={rows}
        loading={loading}
        error={error}
        onRetry={() => void fetchRankings()}
        emptyText={type === 'rating' ? '暂无个人 Rating 数据' : '暂无个人做题量数据'}
        isCurrentRow={row => row.id === user?.userId || row.username === user?.username}
        columns={[
          {
            key: 'rank',
            label: '排名',
            render: (_, index) => startIndex + index + 1
          },
          { key: 'username', label: '用户名', render: row => <span style={{ fontWeight: row.username === user?.username ? 700 : 500 }}>{row.username}{row.username === user?.username ? '（我）' : ''}</span> },
          {
            key: valueKey,
            label: valueLabel,
            render: row => (
              <span style={{ fontWeight: 600 }}>
                {type === 'rating' ? row.rating : row.solvedCount}
              </span>
            )
          }
        ]}
      />

      {!loading && !error && total > 0 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize)
            setPage(1)
          }}
          pageSizeOptions={[10, 20, 50, 100]}
          showTotal
          showQuickJumper
        />
      )}
    </div>
  )
}
