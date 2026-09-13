'use client'

import { useState, useEffect } from 'react'
import unifiedStyles from './TeachersTab.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Table } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { FormDialog } from '@/components/ui/Dialogs'
import { FormField } from '@/components/ui/FormField'
import { Pagination } from '@/components/ui/Pagination'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { useToast } from '@/components/ui/Toast'
import { useModal } from '@/hooks/form/useModal'
import { useForm } from '@/hooks/form/useForm'
import apiClient from '@/lib/apiClient'
import { Badge } from '@/components/ui/Badge'
import { ActionMenu, ActionMenuItem, IdentityCell, ManagementToolbar, managementListStyles } from '@/components/management/ManagementList'

interface School {
  id: string
  name: string
}

interface Teacher {
  id: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
  membershipId?: string
  memberRole?: string
  status?: string
  user: {
    username: string
    status: string
    avatar?: string | null
  }
}

interface TeachersTabProps {
  school: School
  isPrincipal: boolean
  showHeader?: boolean
  showActions?: boolean
  organizationId?: string
}

export default function TeachersTab({ school, isPrincipal, showHeader = false, showActions = true, organizationId }: TeachersTabProps) {
  const teachersEndpoint = '/api/organizations/' + organizationId + '/members/teachers'
  const toast = useToast()
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20
  })
  const addModal = useModal<Teacher>()
  const transferModal = useModal()
  const [selectedNewPrincipal, setSelectedNewPrincipal] = useState('')
  const [transferring, setTransferring] = useState(false)
  const [filters, setFilters] = useState({ q: '', role: '', status: '' })

  // ConfirmModal 状态
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => void
    danger?: boolean
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} })

  useEffect(() => {
    fetchTeachers()
  }, [teachersEndpoint, pagination.page, pagination.pageSize, filters])

  const fetchTeachers = async () => {
    setLoading(true)
    try {
      const result = await apiClient.get<{ data: Teacher[]; total: number }>(
        teachersEndpoint + '?' + new URLSearchParams({ page: String(pagination.page), pageSize: String(pagination.pageSize), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) })
      )
      if (result.success) {
        setTeachers(result.data?.data || [])
        setTotal(result.data?.total || 0)
      }
    } catch (error) {
      console.error('Failed to fetch teachers:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    setConfirmState({
      isOpen: true,
      title: '删除教师',
      message: '确定要删除该教师吗？',
      danger: true,
      onConfirm: async () => {
        try {
          const result = await apiClient.delete(teachersEndpoint + '/' + id)
          if (result.success) {
            toast.success('删除成功')
            fetchTeachers()
          } else {
            toast.error(result.message || '删除失败')
          }
        } catch {
          toast.error('删除失败')
        } finally {
          setConfirmState(prev => ({ ...prev, isOpen: false }))
        }
      }
    })
  }

  const handleToggleStatus = async (teacher: Teacher) => {
    const newStatus = (teacher.status || teacher.user.status) === 'active' ? 'disabled' : 'active'
    const action = newStatus === 'active' ? '启用' : '禁用'

    setConfirmState({
      isOpen: true,
      title: `${action}教师`,
      message: `确定要${action}该教师吗？`,
      danger: newStatus === 'disabled',
      onConfirm: async () => {
        try {
          const result = await apiClient.put(teachersEndpoint + '/' + teacher.id + '/status', { status: newStatus })
          if (result.success) {
            toast.success(`${action}成功`)
            fetchTeachers()
          } else {
            toast.error(result.message || '操作失败')
          }
        } catch {
          toast.error('操作失败')
        } finally {
          setConfirmState(prev => ({ ...prev, isOpen: false }))
        }
      }
    })
  }

  const handleTransferPrincipal = async () => {
    if (!selectedNewPrincipal) {
      toast.warning('请选择新的学校负责人')
      return
    }

    setConfirmState({
      isOpen: true,
      title: '转移学校负责人',
      message: '确定要转移学校负责人吗？转移后您将失去学校负责人权限。',
      danger: true,
      onConfirm: async () => {
        setTransferring(true)
        try {
          const result = await apiClient.post('/api/organizations/' + organizationId + '/members/principal-transfer', {
            newPrincipalMembershipId: selectedNewPrincipal          })
          if (result.success) {
            toast.success('转移成功')
            transferModal.close()
            setConfirmState(prev => ({ ...prev, isOpen: false }))
            window.location.reload()
          } else {
            toast.error(result.message || '转移失败')
          }
        } catch {
          toast.error('转移失败')
        } finally {
          setTransferring(false)
        }
      }
    })
  }

  const transferableTeachers = teachers.filter(
    (t) => t.memberRole !== 'school_principal' && (t.status || t.user.status) === 'active'
  )

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

  return (
    <div className={managementListStyles.page}>
      {showActions && isPrincipal && <div className={unifiedStyles.u1}><Button onClick={() => addModal.open()}>添加教师</Button></div>}
      <ManagementToolbar total={total} noun="教师">
        <Input className={managementListStyles.search} value={filters.q} onChange={event => updateFilter('q', event.target.value)} placeholder="搜索姓名或用户名" aria-label="搜索教师" />
        <Select className={managementListStyles.select} value={filters.role} onChange={event => updateFilter('role', event.target.value)} aria-label="身份筛选"><option value="">身份：全部</option><option value="school_principal">学校负责人</option><option value="teacher">教师</option></Select>
        <Select className={managementListStyles.select} value={filters.status} onChange={event => updateFilter('status', event.target.value)} aria-label="状态筛选"><option value="">状态：全部</option><option value="active">正常</option><option value="disabled">已禁用</option></Select>
      </ManagementToolbar>

      <Table
        data={teachers}
        loading={loading}
        emptyText="暂无教师数据"
        columns={[
          {
            key: 'name', label: '教师', width: '30%',
            render: (teacher) => <IdentityCell name={teacher.name} username={teacher.user?.username} avatar={teacher.user?.avatar} />
          },
          {
            key: 'role', label: '身份', width: '18%',
            render: (teacher) =>
 teacher.memberRole === 'school_principal' ? '学校负责人' : '教师'
          },
          {
            key: 'contact', label: '联系方式', width: '26%',
            render: (teacher) => {
              const phone = teacher.phone ? teacher.phone.replace(/^(\d{3})\d+(\d{4})$/, '$1 **** $2') : ''
              return <span className={managementListStyles.contact}><span>{teacher.email || '-'}</span>{phone && <span className={managementListStyles.contactSecondary}>{phone}</span>}</span>
            }
          },
 { key: 'status', label: '状态', width: '14%', render: teacher => <Badge variant={(teacher.status || teacher.user.status) === 'active' ? 'success' : 'neutral'} dot>{(teacher.status || teacher.user.status) === 'active' ? '正常' : '已禁用'}</Badge>
          }
        ]}
        actions={
          showActions && isPrincipal
            ? (teacher) => (
                <>
                  <Button variant="text" onClick={() => addModal.open(teacher)}>
                    编辑
                  </Button>
 {teacher.memberRole !== 'school_principal' && <ActionMenu><ActionMenuItem onClick={() => handleToggleStatus(teacher)}>{(teacher.status || teacher.user.status) === 'active' ? '禁用账号' : '启用账号'}</ActionMenuItem><ActionMenuItem danger onClick={() => handleDelete(teacher.id)}>删除教师</ActionMenuItem></ActionMenu>}
                </>
              )
            : undefined
        }
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

      {addModal.isOpen && (
        <TeacherFormModal
          teacher={addModal.data}
          schoolId={school.id}
          organizationId={organizationId}
          teachersEndpoint={teachersEndpoint}
          onClose={addModal.close}
          onSuccess={() => {
            addModal.close()
            fetchTeachers()
          }}
        />
      )}

      {transferModal.isOpen && (
        <FormDialog isOpen={true} onClose={transferModal.close} title="转移学校负责人" size="md">
          <div className={unifiedStyles.u2}>
            <p className={unifiedStyles.u3}>
              选择新的学校负责人。转移后，您将失去学校负责人权限，新负责人将获得管理本校教师的权限。
            </p>
            <FormField label="选择新负责人" required>
              <Select aria-label="选择"
                value={selectedNewPrincipal}
                onChange={(e) => setSelectedNewPrincipal(e.target.value)}
              >
                <option value="">请选择</option>
                {transferableTeachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name} ({teacher.user.username})
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className={unifiedStyles.u4}>
            <Button onClick={handleTransferPrincipal} disabled={transferring || !selectedNewPrincipal}>
              {transferring ? '转移中...' : '确认转移'}
            </Button>
            <Button variant="secondary" onClick={transferModal.close}>
              取消
            </Button>
          </div>
        </FormDialog>
      )}

      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        danger={confirmState.danger}
      />
    </div>
  )
}

function TeacherFormModal({
  organizationId,
  teachersEndpoint,
  teacher,
  schoolId,
  onClose,
  onSuccess
}: {
  organizationId?: string
  teachersEndpoint: string
  teacher: Teacher | null
  schoolId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const toast = useToast()

  const form = useForm(
    {
      name: teacher?.name || '',
      username: teacher?.user.username || '',
      password: '',
      title: teacher?.title || '',
      email: teacher?.email || '',
      phone: teacher?.phone || ''
    },
    async (values) => {
      // 验证至少有一个联系方式
      if (!values.email && !values.phone) {
        toast.warning('至少需要填写邮箱或手机号其中一个')
        return
      }

      setSubmitting(true)
      try {
        const body: any = {
          name: values.name,
          title: values.title || null,
          email: values.email || null,
          phone: values.phone || null
        }

        if (!teacher) {
          body.username = values.username
          body.password = values.password
        } else if (values.password) {
          body.password = values.password
        }

        const result = teacher
          ? await apiClient.put(teachersEndpoint + '/' + teacher.id, body)
          : await apiClient.post(teachersEndpoint, body)

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
    <FormDialog isOpen={true} onClose={onClose} title={teacher ? '编辑教师' : '添加教师'} size="md">
      <form onSubmit={form.handleSubmit} className={unifiedStyles.u5}>
        <FormField label="姓名" required>
          <Input
            type="text"
            value={form.values.name}
            onChange={(e) => form.handleChange('name', e.target.value)}
            required
          />
        </FormField>

        <FormField label="用户名" required>
          <Input
            type="text"
            value={form.values.username}
            onChange={(e) => form.handleChange('username', e.target.value)}
            required
            disabled={!!teacher}
          />
        </FormField>

        <FormField label="密码" required={!teacher}>
          <Input
            type="password"
            value={form.values.password}
            onChange={(e) => form.handleChange('password', e.target.value)}
            required={!teacher}
            placeholder={teacher ? '留空则不修改' : ''}
          />
        </FormField>

        <FormField label="职称">
          <Input
            type="text"
            value={form.values.title}
            onChange={(e) => form.handleChange('title', e.target.value)}
            placeholder="如：高级教师"
          />
        </FormField>

        <FormField label="邮箱">
          <Input
            type="email"
            value={form.values.email}
            onChange={(e) => form.handleChange('email', e.target.value)}
            placeholder="如：teacher@example.com"
          />
        </FormField>

        <FormField label="联系电话">
          <Input
            type="tel"
            value={form.values.phone}
            onChange={(e) => form.handleChange('phone', e.target.value)}
            placeholder="如：13900000000"
          />
        </FormField>

        <div className={unifiedStyles.u6}>
          * 邮箱和电话至少填写一个
        </div>

        <div className={unifiedStyles.u7}>
          <Button type="submit" disabled={submitting} className={unifiedStyles.u8}>
            {submitting ? '保存中...' : '保存'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} className={unifiedStyles.u8}>
            取消
          </Button>
        </div>
      </form>
    </FormDialog>
  )
}
