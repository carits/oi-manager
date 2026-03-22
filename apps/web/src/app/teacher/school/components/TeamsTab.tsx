'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Table } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { useTeams } from '@/hooks/data/useTeams'

interface TeamsTabProps {
  schoolId: string
  sessionKey?: string | null
}

export default function TeamsTab({ schoolId, sessionKey }: TeamsTabProps) {
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20 })

  const { data, loading } = useTeams({
    schoolId,
    page: pagination.page,
    pageSize: pagination.pageSize
  }, sessionKey)

  const teams = data?.list || []
  const total = data?.total || 0
  const totalPages = data?.totalPages || 1

  const handlePageChange = (page: number) => {
    setPagination(prev => ({ ...prev, page }))
  }

  const handlePageSizeChange = (pageSize: number) => {
    setPagination(prev => ({ ...prev, page: 1, pageSize }))
  }

  return (
    <div>
      <Table
        data={teams}
        loading={loading}
        emptyText="暂无团队数据"
        columns={[
          {
            key: 'name',
            label: '团队名称',
            render: (team) => (
              <Link
                href={`/teacher/teams/${team.id}`}
                style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}
              >
                {team.name}
              </Link>
            )
          },
          { key: 'owner.name', label: '所有者' },
          {
            key: 'members',
            label: '成员数量',
            render: (team) => team._count?.members || 0
          },
          {
            key: 'isPublic',
            label: '类型',
            render: (team) => (
              <span style={{
                padding: '0.25rem 0.5rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                background: team.isPublic ? 'var(--green-100)' : 'var(--gray-100)',
                color: team.isPublic ? 'var(--green-700)' : 'var(--gray-700)'
              }}>
                {team.isPublic ? '公有' : '私有'}
              </span>
            )
          },
          {
            key: 'description',
            label: '描述',
            render: (team) => (
              <span style={{
                maxWidth: '200px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'inline-block',
                color: team.description ? 'var(--gray-700)' : 'var(--gray-400)'
              }}>
                {team.description || '-'}
              </span>
            )
          }
        ]}
      />

      {!loading && total > 0 && (
        <Pagination
          currentPage={pagination.page}
          totalPages={totalPages}
          total={total}
          pageSize={pagination.pageSize}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
          pageSizeOptions={[10, 20, 50, 100]}
          showTotal={true}
          showQuickJumper={true}
        />
      )}
    </div>
  )
}