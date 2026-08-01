'use client'

import { useEffect, useState } from 'react'
import { Table } from '@/components/ui/Table'
import { Pagination } from '@/components/ui/Pagination'
import { calculateStudentGrade, isStudentGraduated, type StudentForGrade } from '@/lib/grade'
import apiClient from '@/lib/apiClient'
import { useAuth } from '@/components/AuthProvider'

interface SolvedCountTabProps {
  schoolId: string
  educationSystem?: string | null
}

interface SolvedStudent extends StudentForGrade {
  id: string
  name: string
  solvedCount: number
  educationSystem?: string | null
  schoolType?: string | null
}

export default function SolvedCountTab({ schoolId, educationSystem }: SolvedCountTabProps) {
  const { user } = useAuth()
  const [allStudents, setAllStudents] = useState<SolvedStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [includeGraduated, setIncludeGraduated] = useState(false)
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20
  })

  useEffect(() => {
    fetchSolvedRankings()
  }, [schoolId])

  useEffect(() => {
    setPagination(prev => ({ ...prev, page: 1 }))
  }, [includeGraduated])

  const fetchSolvedRankings = async () => {
    setLoading(true)
    try {
      const result = await apiClient.get<SolvedStudent[]>(`/api/schools/${schoolId}/student-solved-rankings`)
      if (result.success) {
        setAllStudents(result.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch solved rankings:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredStudents = includeGraduated
    ? allStudents
    : allStudents.filter((s: SolvedStudent) => !isStudentGraduated(s))

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

  const solvedColor = (count: number) => {
    if (count >= 100) return 'var(--success)'
    if (count >= 50) return 'var(--info)'
    if (count >= 20) return 'var(--warning)'
    return 'var(--text-secondary)'
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
        emptyText="暂无做题量数据"
        isCurrentRow={student => student.id === user?.studentId}
        columns={[
          {
            key: 'rank',
            label: '排名',
            render: (_, index) => startIndex + index + 1
          },
          { key: 'name', label: '姓名' },
          {
            key: 'solvedCount',
            label: '做题量',
            render: (student) => (
              <span style={{ fontWeight: 600, color: solvedColor(student.solvedCount) }}>
                {student.solvedCount}
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
