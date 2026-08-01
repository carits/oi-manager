'use client'

import { useEffect, useState } from 'react'
import { Table } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { calculateStudentGrade, isStudentGraduated, type StudentForGrade } from '@/lib/grade'
import apiClient from '@/lib/apiClient'
import { useAuth } from '@/components/AuthProvider'

interface RankingsTabProps {
  schoolId: string
  educationSystem?: string | null
}

interface RankingStudent extends StudentForGrade {
  id: string
  name: string
  rating: number
  teams?: Array<{ team: { name: string } }>
  educationSystem?: string | null
  schoolType?: string | null
}

export default function RankingsTab({ schoolId, educationSystem }: RankingsTabProps) {
  const { user } = useAuth()
  const [allStudents, setAllStudents] = useState<RankingStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [includeGraduated, setIncludeGraduated] = useState(false)
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20
  })

  useEffect(() => {
    fetchRankings()
  }, [schoolId])

  // 当 includeGraduated 改变时重置到第一页
  useEffect(() => {
    setPagination(prev => ({ ...prev, page: 1 }))
  }, [includeGraduated])

  const fetchRankings = async () => {
    setLoading(true)
    try {
      const result = await apiClient.get<RankingStudent[]>(`/api/schools/${schoolId}/student-rankings`)
      if (result.success) {
        setAllStudents(result.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch rankings:', error)
    } finally {
      setLoading(false)
    }
  }

  // 过滤已毕业学生
  const filteredStudents = includeGraduated
    ? allStudents
    : allStudents.filter((s: RankingStudent) => !isStudentGraduated(s))

  // 分页计算
  const total = filteredStudents.length
  const totalPages = Math.ceil(total / pagination.pageSize)
  const startIndex = (pagination.page - 1) * pagination.pageSize
  const paginatedStudents = filteredStudents.slice(startIndex, startIndex + pagination.pageSize)

  const handlePageChange = (page: number) => {
    setPagination(prev => ({ ...prev, page }))
  }

  const handlePageSizeChange = (pageSize: number) => {
    setPagination(prev => ({ ...prev, page: 1, pageSize }))
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
          <input
            type="checkbox"
            checked={includeGraduated}
            onChange={(e) => setIncludeGraduated(e.target.checked)}
          />
          包含已毕业学生
        </label>
      </div>

      <Table
        data={paginatedStudents}
        loading={loading}
        emptyText="暂无排名数据"
        isCurrentRow={student => student.id === user?.studentId}
        columns={[
          {
            key: 'rank',
            label: '排名',
            render: (_, index) => startIndex + index + 1
          },
          { key: 'name', label: '姓名' },
          {
            key: 'rating',
            label: 'Rating',
            render: (student) => (
              <span
                style={{
                  fontWeight: 600,
                  color:
                    student.rating >= 1500
                      ? 'var(--success)'
                      : student.rating >= 1200
                      ? 'var(--warning)'
                      : 'var(--text-secondary)'
                }}
              >
                {student.rating}
              </span>
            )
          },
          {
            key: 'enrollmentYear',
            label: '年级',
            render: (student) => calculateStudentGrade(student)
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
