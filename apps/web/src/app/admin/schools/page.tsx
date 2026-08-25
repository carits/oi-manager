'use client'

import { useState } from 'react'
import unifiedStyles from './page.unified.module.css'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Pagination } from '@/components/ui/Pagination'
import { useSchools, School } from '@/hooks/data/useSchools'
import { useAuth } from '@/components/AuthProvider'
import { ActionMenu, ActionMenuItem } from '@/components/management/ManagementList'
import Link from 'next/link'

export default function AdminSchoolsPage() {
  const { sessionKey } = useAuth()
  const router = useRouter()
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20
  })

  const { data, loading, error } = useSchools(pagination, sessionKey)

  const schools = data?.data || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / pagination.pageSize)

  const handlePageChange = (page: number) => {
    setPagination(prev => ({ ...prev, page }))
  }

  const handlePageSizeChange = (pageSize: number) => {
    setPagination(prev => ({ ...prev, page: 1, pageSize }))
  }

  return (
    <>
      <div className={unifiedStyles.u1}>
        <main className={unifiedStyles.u2}>
          <PageHeader title="学校管理">
            <Button onClick={() => router.push('/admin/schools/new')}>+ 创建学校</Button>
          </PageHeader>

          {error ? (
            <div className={unifiedStyles.u3}>
              {error}
            </div>
          ) : (
            <Table
              data={schools}
              loading={loading}
              emptyText="暂无学校数据"
              columns={[
                { key: 'name', label: '学校名称', width: '15%' },
                {
                  key: 'schoolType',
                  label: '类型',
                  render: (school) => school.schoolType || '-'
                },
                {
                  key: 'region',
                  label: '区域',
                  render: (school) => school.region || '-'
                },
                {
                  key: 'principal',
                  label: '负责人',
                  render: (school) =>
                    school.principal ? (
                      school.principal.name
                    ) : (
                      <span className={unifiedStyles.u4}>待指派</span>
                    )
                },
                {
                  key: 'contactPerson',
                  label: '联系人',
                  render: (school) => school.contactPerson || '-'
                },
                {
                  key: 'contactPhone',
                  label: '联系电话',
                  render: (school) => school.contactPhone || '-'
                },
                {
                  key: 'status',
                  label: '状态',
                  render: (school) => (
                    <Badge variant={school.status === 'active' ? 'success' : 'error'}>
                      {school.status === 'active' ? '正常' : '禁用'}
                    </Badge>
                  )
                }
              ]}
              actions={(school) => (
                <>
                  <Link
                    href={`/admin/schools/${school.id}`}
                    className={unifiedStyles.u5}
                  >
                    查看
                  </Link>
                  <ActionMenu><ActionMenuItem onClick={() => router.push(`/admin/schools/${school.id}/edit`)}>编辑学校</ActionMenuItem></ActionMenu>
                </>
              )}
            />
          )}

          {!error && !loading && (
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
        </main>
      </div>
    </>
  )
}
