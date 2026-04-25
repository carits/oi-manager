'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Table } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { useModal } from '@/hooks/form/useModal'
import { useDelete } from '@/hooks/actions/useDelete'
import { calculateStudentGrade } from '@/lib/grade'
import apiClient from '@/lib/apiClient'

interface StudentsTabProps {
  schoolId: string
  showHeader?: boolean
}

interface Student {
  id: string
  userId: string | null
  name: string
  gender: string | null
  schoolId: string | null
  headTeacherId: string | null
  enrollmentYear: number | null
  rating: number
  createdAt: string
  user?: {
    username: string
    status: string
  } | null
  school?: {
    id: string
    name: string
    educationSystem?: string | null
    schoolType?: string | null
  } | null
  teams?: Array<{
    team: {
      id: string
      name: string
    }
  }>
  headTeacher?: {
    id: string
    name: string
  } | null
}

// 每页最大学生数量
const MAX_STUDENTS_PER_PAGE = 30

export default function StudentsTab({ schoolId, showHeader = false }: StudentsTabProps) {
  const router = useRouter()
  const [allStudents, setAllStudents] = useState<Student[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const modal = useModal()

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const result = await apiClient.get<{ list: Student[] }>(`/api/students?schoolId=${schoolId}&pageSize=1000`)
      if (result.success) {
        setAllStudents(result.data?.list || [])
        setPage(1)
      }
    } catch (error) {
      console.error('Failed to fetch students:', error)
    } finally {
      setLoading(false)
    }
  }, [schoolId])

  useEffect(() => {
    refetch()
  }, [refetch])

  const { deleteItem } = useDelete('/api/students', refetch)
  const showActions = !showHeader

  // 计算分页数据
  const { pages, totalPages } = useMemo(() => {
    if (allStudents.length === 0) return { pages: [], totalPages: 0 }

    // 按入学年份排序
    const sortedStudents = [...allStudents].sort((a, b) => {
      const yearA = a.enrollmentYear || 0
      const yearB = b.enrollmentYear || 0
      return yearB - yearA
    })

    // 按年级分组，保持顺序
    const gradeGroups: { grade: string; students: Student[] }[] = []
    let currentGrade = ''
    let currentStudents: Student[] = []

    sortedStudents.forEach(student => {
      const grade = calculateStudentGrade(student)
      if (grade !== currentGrade) {
        if (currentStudents.length > 0) {
          gradeGroups.push({ grade: currentGrade, students: currentStudents })
        }
        currentGrade = grade
        currentStudents = [student]
      } else {
        currentStudents.push(student)
      }
    })
    if (currentStudents.length > 0) {
      gradeGroups.push({ grade: currentGrade, students: currentStudents })
    }

    // 智能分页：优先在年级边界切分
    const pagesData: { grade: string; students: Student[] }[][] = []
    let currentPage: { grade: string; students: Student[] }[] = []
    let currentPageCount = 0

    for (const group of gradeGroups) {
      const groupCount = group.students.length

      // 如果当前页为空，直接添加（即使超过限制）
      if (currentPageCount === 0) {
        // 如果单个年级人数超过限制，需要切分
        if (groupCount > MAX_STUDENTS_PER_PAGE) {
          // 先保存之前的数据
          if (currentPage.length > 0) {
            pagesData.push(currentPage)
            currentPage = []
            currentPageCount = 0
          }
          // 切分大年级
          let remaining = [...group.students]
          while (remaining.length > 0) {
            const chunk = remaining.splice(0, MAX_STUDENTS_PER_PAGE)
            pagesData.push([{ grade: group.grade, students: chunk }])
          }
        } else {
          currentPage.push(group)
          currentPageCount += groupCount
        }
      }
      // 如果添加这个年级不会超过限制，直接添加
      else if (currentPageCount + groupCount <= MAX_STUDENTS_PER_PAGE) {
        currentPage.push(group)
        currentPageCount += groupCount
      }
      // 如果添加这个年级会超过限制，在年级边界切分
      else {
        pagesData.push(currentPage)
        currentPage = [group]
        currentPageCount = groupCount
      }
    }

    // 保存最后一页
    if (currentPage.length > 0) {
      pagesData.push(currentPage)
    }

    return { pages: pagesData, totalPages: pagesData.length }
  }, [allStudents])

  // 当前页数据
  const currentPageData = pages[page - 1] || []
  const currentPageStudentCount = currentPageData.reduce((sum, g) => sum + g.students.length, 0)

  return (
    <div>
      {showActions && (
        <div style={{ marginBottom: '1rem' }}>
          <Button onClick={() => modal.open()}>+ 添加学生</Button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
          加载中...
        </div>
      ) : allStudents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
          暂无学生数据
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {currentPageData.map((group, idx) => (
            <div key={`${group.grade}-${idx}`}>
              <h3 style={{
                fontSize: '1rem',
                fontWeight: 600,
                marginBottom: '0.75rem',
                color: 'var(--gray-900)'
              }}>
                {group.grade} ({group.students.length}人)
              </h3>
              <Table
                data={group.students}
                loading={false}
                emptyText=""
                columns={[
                  {
                    key: 'name',
                    label: '姓名',
                    render: (student) => (
                      <span
                        onClick={() => router.push(`/profile/student/${student.id}`)}
                        style={{ cursor: 'pointer', color: 'var(--primary)' }}
                      >
                        {student.name}
                      </span>
                    )
                  },
                  {
                    key: 'user.username',
                    label: '用户名',
                    render: (student) => student.user?.username || '-'
                  },
                  {
                    key: 'headTeacher.name',
                    label: '主教练',
                    render: (student) => student.headTeacher?.name || '-'
                  },
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
                              : 'var(--gray-600)'
                        }}
                      >
                        {student.rating}
                      </span>
                    )
                  }
                ]}
                actions={
                  showActions
                    ? (student) => (
                        <>
                          <Button variant="text" onClick={() => modal.open(student)}>编辑</Button>
                          <Button
                            variant="text"
                            style={{ color: 'var(--error)' }}
                            onClick={() => deleteItem(student.id, '确定要删除该学生吗？')}
                          >
                            删除
                          </Button>
                        </>
                      )
                    : undefined
                }
              />
            </div>
          ))}

          {/* 分页导航 */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '1rem',
              padding: '0.75rem',
              background: 'var(--gray-50)',
              borderRadius: '6px'
            }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                第 {page} 页，当前 {currentPageStudentCount} 人 / 共 {allStudents.length} 人
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  上一页
                </Button>
                <span style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 0.75rem',
                  fontSize: '0.875rem',
                  color: 'var(--gray-700)'
                }}>
                  {page} / {totalPages}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}