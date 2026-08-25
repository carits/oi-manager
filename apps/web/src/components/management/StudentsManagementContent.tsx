'use client'

import { useState, useEffect, useMemo } from 'react'
import unifiedStyles from './StudentsManagementContent.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { useParams, useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Button } from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import { FormDialog } from '@/components/ui/Dialogs'
import { Pagination } from '@/components/ui/Pagination'
import { useStudents, Student } from '@/hooks/data/useStudents'
import { useModal } from '@/hooks/form/useModal'
import { useDelete } from '@/hooks/actions/useDelete'
import { useForm } from '@/hooks/form/useForm'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { calculateStudentGrade } from '@/lib/grade'
import { formStyles } from '@/lib/styles'
import { Badge } from '@/components/ui/Badge'
import { ActionMenu, ActionMenuItem, IdentityCell, ManagementToolbar, managementListStyles } from '@/components/management/ManagementList'

interface Teacher {
  id: string
  name: string
}

export default function StudentsManagementContent() {
  const router = useRouter()
  const { organizationId } = useParams<{ organizationId?: string }>()
  const { user, sessionKey } = useAuth()
  const studentsEndpoint = organizationId ? '/api/organizations/' + organizationId + '/members/students' : '/api/organizations/__retired__/members/students'
  const teachersEndpoint = organizationId ? '/api/organizations/' + organizationId + '/members/teachers' : null
  const toast = useToast()
  const [confirmState, setConfirmState] = useState<{ id: string; message: string; action: () => Promise<void> } | null>(null)
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [transferringStudent, setTransferringStudent] = useState<Student | null>(null)
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('')
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20
  })
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [filters, setFilters] = useState({ q: '', grade: '', headTeacherMembershipId: '', status: '' })

  const isPrincipal = user?.organizationRole === 'school_principal'

  const filterParams = useMemo(() => ({ ...filters, ...pagination }), [filters, pagination])

  const { data, loading, refetch } = useStudents(filterParams, sessionKey, studentsEndpoint)
  const modal = useModal<Student>()
  const { deleteItem } = useDelete(studentsEndpoint, refetch)

  // 禁用/启用账号
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const toggleAccountStatus = async (studentId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'disabled' ? 'active' : 'disabled'
    const action = newStatus === 'disabled' ? '禁用' : '启用'
    setConfirmState({
      id: studentId,
      message: `确定要${action}该学生账号吗？`,
      action: async () => {
        setTogglingId(studentId)
        try {
          const endpoint = studentsEndpoint + '/' + studentId + '/status'
          const res = await apiClient.put(endpoint, { status: newStatus })
          if (res.success) {
            toast.success(`${action}成功`)
            refetch()
          } else {
            toast.error(res.message || `${action}失败`)
          }
        } catch {
          toast.error(`${action}失败`)
        } finally {
          setTogglingId(null)
        }
      }
    })
  }

  // Toast 自动关闭
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToastMsg(null), 2500)
      return () => clearTimeout(timer)
    }
  }, [toast])



  // 获取教师列表（用于转移主教练）
  useEffect(() => {
    const fetchTeachers = async () => {
      if (!isPrincipal) return
      try {
        if (!teachersEndpoint) return
        const result = await apiClient.get<{ data: Teacher[]; total: number }>(teachersEndpoint + '?pageSize=100')
        if (result.success && result.data) {
          setTeachers(result.data.data)
        }
      } catch (error) {
        console.error('Failed to fetch teachers:', error)
      }
    }
    void fetchTeachers()
  }, [isPrincipal, teachersEndpoint])

  // 学生列表直接使用后端返回的数据（后端已根据 headTeacherId 筛选）
  const students = data?.data || []

  const total = data?.total || 0
  const totalPages = Math.ceil(total / pagination.pageSize)

  const handlePageChange = (page: number) => {
    setPagination(prev => ({ ...prev, page }))
  }

  const handlePageSizeChange = (pageSize: number) => {
    setPagination(prev => ({ ...prev, page: 1, pageSize }))
  }

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters(current => ({ ...current, [key]: value }))
    setPagination(current => ({ ...current, page: 1 }))
  }

  const gradeOptions = data?.filters?.grades || []

  // 转移主教练
  const handleConfirmTransfer = async () => {
    if (!transferringStudent || !selectedTeacherId) {
      toast.warning('请选择主教练')
      return
    }

    try {
      const result = await apiClient.put(studentsEndpoint + '/' + transferringStudent.id, {
        name: transferringStudent.name,
        gender: transferringStudent.gender,
        enrollmentYear: transferringStudent.enrollmentYear,
        headTeacherMembershipId: selectedTeacherId
      })
      if (result.success) {
        toast.success('转移成功')
        setTransferringStudent(null)
        setSelectedTeacherId('')
        refetch()
      } else {
        toast.error(result.message || '转移失败')
      }
    } catch (error) {
      toast.error('转移失败')
    }
  }

  return (
    <>
      <div className={managementListStyles.page}>
        <PageHeader title="学生" description="管理本校学生信息">
          <div className={unifiedStyles.u1}>
            <Button variant="secondary" onClick={() => router.push(`/org/${organizationId}/management?tab=students`)}>
              导入学生
            </Button>
            <Button onClick={() => modal.open()}>添加学生</Button>
          </div>
        </PageHeader>

        <ManagementToolbar total={total} noun="学生">
          <Input className={managementListStyles.search} value={filters.q} onChange={event => updateFilter('q', event.target.value)} placeholder="搜索姓名或用户名" aria-label="搜索学生" />
          <Select className={managementListStyles.select} value={filters.grade} onChange={event => updateFilter('grade', event.target.value)} aria-label="年级筛选"><option value="">年级：全部</option>{gradeOptions.map(grade => <option key={grade} value={grade}>{grade}</option>)}</Select>
          {isPrincipal && <Select className={managementListStyles.select} value={filters.headTeacherMembershipId} onChange={event => updateFilter('headTeacherMembershipId', event.target.value)} aria-label="主教练筛选"><option value="">主教练：全部</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</Select>}
          <Select className={managementListStyles.select} value={filters.status} onChange={event => updateFilter('status', event.target.value)} aria-label="状态筛选"><option value="">状态：全部</option><option value="active">正常</option><option value="disabled">已禁用</option></Select>
        </ManagementToolbar>
        <Table
          data={students}
          loading={loading}
          emptyText="暂无学生数据"
          columns={[
            {
              key: 'name', label: '学生', width: '28%',
              render: (student) => <IdentityCell name={student.name} username={student.user?.username} avatar={student.user?.avatar} />
            },
            {
              key: 'rating', label: 'Rating', width: '12%',
              render: (student) => <span className={managementListStyles.rating}>{student.rating}</span>
            },
            {
              key: 'enrollmentYear', label: '年级', width: '12%',
              render: (student) => calculateStudentGrade(student)
            },
            {
              key: 'headTeacher', label: '主教练', width: '17%',
              render: (student) => {
                if (transferringStudent?.id === student.id) {
                  return (
                    <div className={unifiedStyles.u2}>
                      <Select aria-label="选择"
                        value={selectedTeacherId}
                        onChange={(e) => setSelectedTeacherId(e.target.value)}
                        className={unifiedStyles.u3}
                      >
                        <option value="">选择教练</option>
                        {teachers.map((teacher) => (
                          <option key={teacher.id} value={teacher.id}>
                            {teacher.name}
                          </option>
                        ))}
                      </Select>
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
            },
            { key: 'status', label: '状态', width: '12%', render: student => <Badge variant={(student.status || student.user?.status) === 'disabled' ? 'neutral' : 'success'} dot>{(student.status || student.user?.status) === 'disabled' ? '已禁用' : '正常'}</Badge> }
          ]}
          actions={(student) => (
            <>
              <Button variant="text" onClick={() => modal.open(student)}>
                编辑
              </Button>
              <ActionMenu>
                <ActionMenuItem onClick={() => toggleAccountStatus(student.id, student.status || student.user?.status || 'active')}>{togglingId === student.id ? '处理中...' : (student.status || student.user?.status) === 'disabled' ? '启用账号' : '禁用账号'}</ActionMenuItem>
                {isPrincipal && <ActionMenuItem onClick={() => { setTransferringStudent(student); setSelectedTeacherId(student.headTeacherMembershipId || '') }}>转移主教练</ActionMenuItem>}
                <ActionMenuItem danger onClick={() => deleteItem(student.id, '确定要删除该学生吗？')}>删除学生</ActionMenuItem>
              </ActionMenu>
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
            studentsEndpoint={studentsEndpoint}
            organizationId={organizationId}
            onClose={modal.close}
            onSuccess={() => {
              modal.close()
              setToastMsg('保存成功')
              refetch()
            }}
          />
        )}

        {/* Toast 通知 */}
        {toastMsg && (
          <div className={unifiedStyles.u7}>
            {toastMsg}
          </div>
        )}
      </div>
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={async () => { await confirmState?.action(); setConfirmState(null) }}
        title="确认操作"
        message={confirmState?.message || ''}
        confirmText="确认"
        danger
      />
    </>
  )
}


// 学生表单弹窗组件
function StudentFormModal({
  student,
  studentsEndpoint,
  organizationId,
  onClose,
  onSuccess
}: {
  student: Student | null
  studentsEndpoint: string
  organizationId?: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()

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
          headTeacherMembershipId: student?.headTeacherMembershipId || undefined
        }

        const result = student
          ? await apiClient.put(`${studentsEndpoint}/${student.id}`, body)
          : await apiClient.post(studentsEndpoint, body)

        if (result.success) {
          onSuccess()
        } else {
          toast.error(result.message || '操作失败')
        }
      } catch {
        toast.error('操作失败')
      } finally {
        setSubmitting(false)
      }
    }
  )

  return (
    <FormDialog isOpen={true} onClose={onClose} title={student ? '编辑学生' : '添加学生'} size="md">
      <form onSubmit={form.handleSubmit} className={unifiedStyles.u4}>
        <div style={formStyles.field}>
          <label style={formStyles.label}>姓名 *</label>
          <Input
            type="text"
            value={form.values.name}
            onChange={(e) => form.handleChange('name', e.target.value)}
            required
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>性别</label>
          <Select aria-label="选择"
            value={form.values.gender}
            onChange={(e) => form.handleChange('gender', e.target.value)}
            style={formStyles.select}
          >
            <option value="">请选择</option>
            <option value="男">男</option>
            <option value="女">女</option>
          </Select>
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>用户名 *</label>
          <Input
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
          <Input
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
          <Input
            type="number"
            value={form.values.enrollmentYear}
            onChange={(e) => form.handleChange('enrollmentYear', e.target.value)}
            placeholder="如：2024"
            min="2000"
            max="2030"
            style={formStyles.input}
          />
        </div>

        <div className={unifiedStyles.u5}>
          <Button type="submit" disabled={submitting} className={unifiedStyles.u6}>
            {submitting ? '保存中...' : '保存'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} className={unifiedStyles.u6}>
            取消
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}
