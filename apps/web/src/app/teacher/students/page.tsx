'use client'

import { useState, useEffect, useMemo } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Button } from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { PageHeader } from '@/components/ui/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { useStudents, Student } from '@/hooks/data/useStudents'
import { useModal } from '@/hooks/form/useModal'
import { useDelete } from '@/hooks/actions/useDelete'
import { useForm } from '@/hooks/form/useForm'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { calculateStudentGrade } from '@/lib/grade'
import { formStyles } from '@/lib/styles'

interface Teacher {
  id: string
  name: string
}

export default function StudentsPage() {
  const { user, sessionKey } = useAuth()
  const [currentTeacherId, setCurrentTeacherId] = useState<string | null>(null)
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [transferringStudent, setTransferringStudent] = useState<Student | null>(null)
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('')
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20
  })

  const isPrincipal = user?.role === 'school_principal'

  // 普通教师只查询自己的学生，学校负责人查询全校
  // 注意：普通教师需要等 currentTeacherId 获取到后才能查询
  const filterParams = useMemo(() => {
    const baseParams = user?.schoolId ? { schoolId: user.schoolId } : {}
    if (isPrincipal) {
      return { ...baseParams, ...pagination }
    }
    // 普通教师只看自己的学生，如果没有获取到 currentTeacherId 则不查询
    if (!currentTeacherId) {
      return { ...baseParams, headTeacherId: '__loading__', ...pagination }
    }
    return { ...baseParams, headTeacherId: currentTeacherId, ...pagination }
  }, [user?.schoolId, isPrincipal, currentTeacherId, pagination])

  const { data, loading, refetch } = useStudents(filterParams, sessionKey)
  const modal = useModal<Student>()
  const { deleteItem } = useDelete('/api/students', refetch)

  // 获取当前教师ID
  useEffect(() => {
    const fetchCurrentTeacher = async () => {
      try {
        const result = await apiClient.get<{ id: string }>('/api/teachers/me')
        if (result.success && result.data) {
          setCurrentTeacherId(result.data.id)
        }
      } catch (error) {
        console.error('Failed to fetch current teacher:', error)
      }
    }
    fetchCurrentTeacher()
  }, [])

  // 获取教师列表（用于转移主教练）
  useEffect(() => {
    const fetchTeachers = async () => {
      if (!user?.schoolId) return
      try {
        const result = await apiClient.get<Teacher[]>(`/api/schools/${user.schoolId}/teachers`)
        if (result.success && result.data) {
          setTeachers(result.data)
        }
      } catch (error) {
        console.error('Failed to fetch teachers:', error)
      }
    }
    if (user?.schoolId) {
      fetchTeachers()
    }
  }, [user?.schoolId])

  // 学生列表直接使用后端返回的数据（后端已根据 headTeacherId 筛选）
  const students = data?.list || []

  const total = data?.total || 0
  const totalPages = Math.ceil(total / pagination.pageSize)

  const handlePageChange = (page: number) => {
    setPagination(prev => ({ ...prev, page }))
  }

  const handlePageSizeChange = (pageSize: number) => {
    setPagination(prev => ({ ...prev, page: 1, pageSize }))
  }

  // 转移主教练
  const handleConfirmTransfer = async () => {
    if (!transferringStudent || !selectedTeacherId) {
      alert('请选择主教练')
      return
    }

    try {
      const result = await apiClient.put(`/api/students/${transferringStudent.id}`, {
        name: transferringStudent.name,
        gender: transferringStudent.gender,
        enrollmentYear: transferringStudent.enrollmentYear,
        headTeacherId: selectedTeacherId
      })
      if (result.success) {
        alert('转移成功')
        setTransferringStudent(null)
        setSelectedTeacherId('')
        refetch()
      } else {
        alert(result.message || '转移失败')
      }
    } catch (error) {
      alert('转移失败')
    }
  }

  return (
    <ProtectedRoute requiredRole="teacher">
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <PageHeader title="学生管理">
          <Button onClick={() => modal.open()}>+ 添加学生</Button>
        </PageHeader>

        <Table
          data={students}
          loading={loading}
          emptyText="暂无学生数据"
          columns={[
            {
              key: 'name',
              label: '姓名'
            },
            {
              key: 'user.username',
              label: '用户名',
              render: (student) => student.user?.username || '-'
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
                        ? '#16a34a'
                        : student.rating >= 1200
                        ? '#f59e0b'
                        : 'var(--gray-600)'
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
            },
            {
              key: 'headTeacher',
              label: '主教练',
              render: (student) => {
                if (transferringStudent?.id === student.id) {
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <select
                        value={selectedTeacherId}
                        onChange={(e) => setSelectedTeacherId(e.target.value)}
                        style={{
                          padding: '0.25rem 0.5rem',
                          fontSize: '0.875rem',
                          border: '1px solid var(--border)',
                          borderRadius: '4px'
                        }}
                      >
                        <option value="">选择教练</option>
                        {teachers.map((teacher) => (
                          <option key={teacher.id} value={teacher.id}>
                            {teacher.name}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" onClick={handleConfirmTransfer}>
                        确认
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setTransferringStudent(null)
                          setSelectedTeacherId('')
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  )
                }
                return student.headTeacher?.name || '-'
              }
            }
          ]}
          actions={(student) => (
            <>
              <Button variant="text" onClick={() => modal.open(student)}>
                编辑
              </Button>
              {(isPrincipal || student.headTeacherId === currentTeacherId) && (
                <Button
                  variant="text"
                  onClick={() => {
                    setTransferringStudent(student)
                    setSelectedTeacherId(student.headTeacherId || '')
                  }}
                >
                  转移
                </Button>
              )}
              <Button
                variant="text"
                style={{ color: 'var(--error)' }}
                onClick={() => deleteItem(student.id, '确定要删除该学生吗？')}
              >
                删除
              </Button>
            </>
          )}
        />

        {!loading && (
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

        {modal.isOpen && (
          <StudentFormModal
            student={modal.data}
            onClose={modal.close}
            onSuccess={() => {
              modal.close()
              refetch()
            }}
          />
        )}
      </div>
    </ProtectedRoute>
  )
}

// 学生表单弹窗组件
function StudentFormModal({
  student,
  onClose,
  onSuccess
}: {
  student: Student | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [submitting, setSubmitting] = useState(false)

  const form = useForm(
    {
      name: student?.name || '',
      gender: student?.gender || '',
      enrollmentYear: student?.enrollmentYear?.toString() || '',
      username: student?.user?.username || '',
      password: ''
    },
    async (values) => {
      setSubmitting(true)
      try {
        const body = {
          name: values.name,
          gender: values.gender || null,
          enrollmentYear: values.enrollmentYear ? parseInt(values.enrollmentYear) : null,
          username: values.username,
          password: values.password || undefined,
          schoolId: student?.schoolId || undefined,
          headTeacherId: student?.headTeacherId || undefined
        }

        const result = student
          ? await apiClient.put(`/api/students/${student.id}`, body)
          : await apiClient.post('/api/students', body)

        if (result.success) {
          onSuccess()
        } else {
          alert(result.message || '操作失败')
        }
      } catch {
        alert('操作失败')
      } finally {
        setSubmitting(false)
      }
    }
  )

  return (
    <Modal isOpen={true} onClose={onClose} title={student ? '编辑学生' : '添加学生'} width="500px">
      <form onSubmit={form.handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <div style={formStyles.field}>
          <label style={formStyles.label}>姓名 *</label>
          <input
            type="text"
            value={form.values.name}
            onChange={(e) => form.handleChange('name', e.target.value)}
            required
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>性别</label>
          <select
            value={form.values.gender}
            onChange={(e) => form.handleChange('gender', e.target.value)}
            style={formStyles.select}
          >
            <option value="">请选择</option>
            <option value="男">男</option>
            <option value="女">女</option>
          </select>
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>用户名 *</label>
          <input
            type="text"
            value={form.values.username}
            onChange={(e) => form.handleChange('username', e.target.value)}
            required
            disabled={!!student}
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>密码 {!student && '*'}</label>
          <input
            type="password"
            value={form.values.password}
            onChange={(e) => form.handleChange('password', e.target.value)}
            required={!student}
            placeholder={student ? '留空则不修改' : ''}
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>入学年份</label>
          <input
            type="number"
            value={form.values.enrollmentYear}
            onChange={(e) => form.handleChange('enrollmentYear', e.target.value)}
            placeholder="如：2024"
            min="2000"
            max="2030"
            style={formStyles.input}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <Button type="submit" disabled={submitting} style={{ flex: 1 }}>
            {submitting ? '保存中...' : '保存'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} style={{ flex: 1 }}>
            取消
          </Button>
        </div>
      </form>
    </Modal>
  )
}
