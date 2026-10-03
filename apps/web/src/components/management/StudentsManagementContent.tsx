'use client'

import { useState, useEffect, useMemo } from 'react'
import unifiedStyles from './StudentsManagementContent.unified.module.css'
import { Input, Select } from '@/components/ui/FormControls'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { Button } from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { PageHeader } from '@/components/ui/PageHeader'
import { FormDialog } from '@/components/ui/Dialogs'
import { FormField } from '@/components/ui/FormField'
import { Pagination } from '@/components/ui/Pagination'
import { LoadError } from '@/components/ui/LoadError'
import { useModal } from '@/hooks/form/useModal'
import { useForm } from '@/hooks/form/useForm'
import { useAuth } from '@/features/auth'
import { useFeatureResource } from '@/hooks/data/useFeatureResource'
import { useListScrollRestoration } from '@/hooks/useListScrollRestoration'
import {
  archiveOrganizationStudent,
  createOrganizationStudent,
  getOrganizationStudentOptions,
  getOrganizationTeacherOptions,
  updateOrganizationStudent,
  updateOrganizationStudentStatus,
} from '@/features/organization-account'
import { OrganizationContracts, type EndpointData } from '@oi-manager/contracts'
import { calculateStudentGrade } from '@/lib/grade'
import { Badge } from '@/components/ui/Badge'
import { ActionMenu, ActionMenuItem, IdentityCell, ManagementToolbar, managementListStyles } from '@/components/management/ManagementList'

interface Teacher {
  id: string
  membershipId: string
  name: string
}

type StudentListData = EndpointData<typeof OrganizationContracts.studentOptions>
type Student = StudentListData['data'][number]

function positiveInt(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export default function StudentsManagementContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { organizationId } = useParams<{ organizationId?: string }>()
  const { user, sessionKey } = useAuth()
  const toast = useToast()
  const [confirmState, setConfirmState] = useState<{ id: string; message: string; action: () => Promise<void> } | null>(null)
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [transferringStudent, setTransferringStudent] = useState<Student | null>(null)
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('')
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  const isPrincipal = user?.organizationRole === 'school_principal'
  const filters = useMemo(() => ({
    q: searchParams.get('q') || '',
    grade: searchParams.get('grade') || '',
    headTeacherMembershipId: searchParams.get('headTeacherMembershipId') || '',
    status: searchParams.get('status') || '',
  }), [searchParams])
  const pagination = useMemo(() => ({
    page: positiveInt(searchParams.get('page'), 1),
    pageSize: positiveInt(searchParams.get('pageSize'), 20),
  }), [searchParams])
  const filterParams = useMemo(() => ({ ...filters, ...pagination }), [filters, pagination])
  const locationKey = searchParams.toString()
  const resource = useFeatureResource(
    `organization-students:${locationKey}`,
    sessionKey && organizationId ? `${sessionKey}:${organizationId}` : null,
    () => {
      if (!organizationId) throw new Error('当前学校上下文无效')
      return getOrganizationStudentOptions(organizationId, filterParams)
    },
    { keepPreviousData: true },
  )
  const data = resource.data
  const refetch = resource.retry
  useListScrollRestoration(`${organizationId || 'unknown'}:students:${locationKey}`, Boolean(data && !resource.isLoading))
  const modal = useModal<Student>()
  const deleteItem = async (id: string, confirmMessage: string) => {
    if (!organizationId || !window.confirm(confirmMessage)) return false
    try {
      await archiveOrganizationStudent(organizationId, id)
      await refetch()
      return true
    } catch {
      toast.error('删除失败')
      return false
    }
  }

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
          if (!organizationId) throw new Error('当前学校上下文无效')
          await updateOrganizationStudentStatus(organizationId, studentId, newStatus)
          toast.success(`${action}成功`)
          refetch()
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
        if (!organizationId) return
        const result = await getOrganizationTeacherOptions(organizationId)
        setTeachers(result.data)
      } catch (error) {
        console.error('Failed to fetch teachers:', error)
      }
    }
    void fetchTeachers()
  }, [isPrincipal, organizationId])

  // 学生列表直接使用后端返回的数据（后端已根据 headTeacherId 筛选）
  const students = data?.data || []

  const total = data?.total || 0
  const totalPages = Math.ceil(total / pagination.pageSize)

  const navigateList = (changes: Record<string, string | number | null>, mode: 'push' | 'replace') => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || (key === 'page' && value === 1) || (key === 'pageSize' && value === 20)) next.delete(key)
      else next.set(key, String(value))
    }
    const query = next.toString()
    router[mode](`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
  }

  const handlePageChange = (page: number) => navigateList({ page }, 'push')
  const handlePageSizeChange = (pageSize: number) => navigateList({ page: 1, pageSize }, 'replace')
  const updateFilter = (key: keyof typeof filters, value: string) => navigateList({ [key]: value, page: 1 }, 'replace')

  const gradeOptions = data?.filters?.grades || []

  // 转移主教练
  const handleConfirmTransfer = async () => {
    if (!transferringStudent || !selectedTeacherId) {
      toast.warning('请选择主教练')
      return
    }

    try {
      if (!organizationId) throw new Error('当前学校上下文无效')
      await updateOrganizationStudent(organizationId, transferringStudent.id, {
        name: transferringStudent.name,
        gender: transferringStudent.gender,
        enrollmentYear: transferringStudent.enrollmentYear,
        headTeacherMembershipId: selectedTeacherId
      })
      toast.success('转移成功')
      setTransferringStudent(null)
      setSelectedTeacherId('')
      refetch()
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
          {isPrincipal && <Select className={managementListStyles.select} value={filters.headTeacherMembershipId} onChange={event => updateFilter('headTeacherMembershipId', event.target.value)} aria-label="主教练筛选"><option value="">主教练：全部</option>{teachers.map(teacher => <option key={teacher.id} value={teacher.membershipId}>{teacher.name}</option>)}</Select>}
          <Select className={managementListStyles.select} value={filters.status} onChange={event => updateFilter('status', event.target.value)} aria-label="状态筛选"><option value="">状态：全部</option><option value="active">正常</option><option value="disabled">已禁用</option></Select>
        </ManagementToolbar>
        {resource.error && !data ? <LoadError message={resource.error.userMessage} requestId={resource.error.requestId} onRetry={() => void resource.retry()} /> : <>
        {resource.refreshing && data && <p className={unifiedStyles.u8} role="status">正在更新学生列表…</p>}
        {resource.error && <LoadError compact message={resource.error.userMessage} requestId={resource.error.requestId} onRetry={() => void resource.retry()} />}
        <Table
          data={students}
          loading={resource.isLoading}
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
                          <option key={teacher.id} value={teacher.membershipId}>
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

        {!resource.isLoading && (
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
        </>}

        {modal.isOpen && (
          <StudentFormModal
            student={modal.data}
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
  organizationId,
  onClose,
  onSuccess
}: {
  student: Student | null
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

        if (!organizationId) throw new Error('当前学校上下文无效')
        if (student) await updateOrganizationStudent(organizationId, student.id, body)
        else await createOrganizationStudent(organizationId, { ...body, username: values.username, password: values.password })
        onSuccess()
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
        <FormField label="姓名" required>
          <Input
            type="text"
            value={form.values.name}
            onChange={(e) => form.handleChange('name', e.target.value)}
            required
          />
        </FormField>

        <FormField label="性别">
          <Select aria-label="选择"
            value={form.values.gender}
            onChange={(e) => form.handleChange('gender', e.target.value)}
          >
            <option value="">请选择</option>
            <option value="男">男</option>
            <option value="女">女</option>
          </Select>
        </FormField>

        <FormField label="用户名" required>
          <Input
            type="text"
            value={form.values.username}
            onChange={(e) => form.handleChange('username', e.target.value)}
            required
            disabled={!!student}
          />
        </FormField>

        <FormField label="密码" required={!student}>
          <Input
            type="password"
            value={form.values.password}
            onChange={(e) => form.handleChange('password', e.target.value)}
            required={!student}
            placeholder={student ? '留空则不修改' : ''}
          />
        </FormField>

        <FormField label="入学年份">
          <Input
            type="number"
            value={form.values.enrollmentYear}
            onChange={(e) => form.handleChange('enrollmentYear', e.target.value)}
            placeholder="如：2024"
            min="2000"
            max="2030"
          />
        </FormField>

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
