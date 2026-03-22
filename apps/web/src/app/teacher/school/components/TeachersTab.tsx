'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Table } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Pagination } from '@/components/ui/Pagination'
import { useModal } from '@/hooks/form/useModal'
import { useForm } from '@/hooks/form/useForm'
import { getAuthHeaders } from '@/lib/auth'
import { formStyles } from '@/lib/styles'

interface School {
  id: string
  name: string
  currentPrincipalTeacherId: string | null
}

interface Teacher {
  id: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
  user: {
    username: string
    status: string
  }
}

interface TeachersTabProps {
  school: School
  isPrincipal: boolean
  showHeader?: boolean
  showActions?: boolean
}

export default function TeachersTab({ school, isPrincipal, showHeader = false, showActions = true }: TeachersTabProps) {
  const router = useRouter()
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

  useEffect(() => {
    fetchTeachers()
  }, [school.id, pagination.page, pagination.pageSize])

  const fetchTeachers = async () => {
    setLoading(true)
    try {
      const res = await fetch(`http://localhost:3001/api/schools/${school.id}/teachers?page=${pagination.page}&pageSize=${pagination.pageSize}`, {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        setTeachers(data.data.list || [])
        setTotal(data.data.total || 0)
      }
    } catch (error) {
      console.error('Failed to fetch teachers:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该教师吗？')) return

    try {
      const res = await fetch(`http://localhost:3001/api/teachers/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        fetchTeachers()
      } else {
        alert(data.message || '删除失败')
      }
    } catch {
      alert('删除失败')
    }
  }

  const handleToggleStatus = async (teacher: Teacher) => {
    const newStatus = teacher.user.status === 'active' ? 'disabled' : 'active'
    const action = newStatus === 'active' ? '启用' : '禁用'

    if (!confirm(`确定要${action}该教师吗？`)) return

    try {
      const res = await fetch(`http://localhost:3001/api/teachers/${teacher.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ status: newStatus })
      })
      const result = await res.json()
      if (result.success) {
        fetchTeachers()
      } else {
        alert(result.message || '操作失败')
      }
    } catch {
      alert('操作失败')
    }
  }

  const handleTransferPrincipal = async () => {
    if (!selectedNewPrincipal) {
      alert('请选择新的学校负责人')
      return
    }

    if (!confirm('确定要转移学校负责人吗？转移后您将失去学校负责人权限。')) return

    setTransferring(true)
    try {
      const res = await fetch(`http://localhost:3001/api/schools/current/principal-transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ newTeacherId: selectedNewPrincipal })
      })
      const result = await res.json()
      if (result.success) {
        alert('转移成功')
        transferModal.close()
        window.location.reload()
      } else {
        alert(result.message || '转移失败')
      }
    } catch {
      alert('转移失败')
    } finally {
      setTransferring(false)
    }
  }

  const transferableTeachers = teachers.filter(
    (t) => t.id !== school.currentPrincipalTeacherId && t.user.status === 'active'
  )

  const totalPages = Math.ceil(total / pagination.pageSize)

  const handlePageChange = (page: number) => {
    setPagination(prev => ({ ...prev, page }))
  }

  const handlePageSizeChange = (pageSize: number) => {
    setPagination(prev => ({ ...prev, page: 1, pageSize }))
  }

  return (
    <div>
      {showActions && isPrincipal && (
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
          <Button onClick={() => addModal.open()}>+ 添加教师</Button>
          {transferableTeachers.length > 0 && (
            <Button variant="secondary" onClick={() => transferModal.open()}>
              转移负责人
            </Button>
          )}
        </div>
      )}

      <Table
        data={teachers}
        loading={loading}
        emptyText="暂无教师数据"
        columns={[
          {
            key: 'name',
            label: '姓名',
            render: (teacher) => (
              <span
                onClick={() => router.push(`/profile/teacher/${teacher.id}`)}
                style={{ cursor: 'pointer', color: 'var(--primary)' }}
              >
                {teacher.name}
              </span>
            )
          },
          { key: 'user.username', label: '用户名' },
          {
            key: 'role',
            label: '角色',
            render: (teacher) =>
              teacher.id === school.currentPrincipalTeacherId ? '学校负责人' : '教师'
          },
          {
            key: 'contact',
            label: '联系方式',
            render: (teacher) => {
              const contacts = []
              if (teacher.email) contacts.push(teacher.email)
              if (teacher.phone) contacts.push(teacher.phone)
              return contacts.length > 0 ? contacts.join(' / ') : '-'
            }
          }
        ]}
        actions={
          showActions && isPrincipal
            ? (teacher) => (
                <>
                  <Button variant="text" onClick={() => addModal.open(teacher)}>
                    编辑
                  </Button>
                  {teacher.id !== school.currentPrincipalTeacherId && (
                    <>
                      <Button variant="text" onClick={() => handleToggleStatus(teacher)}>
                        {teacher.user.status === 'active' ? '禁用' : '启用'}
                      </Button>
                      <Button
                        variant="text"
                        style={{ color: 'var(--error)' }}
                        onClick={() => handleDelete(teacher.id)}
                      >
                        删除
                      </Button>
                    </>
                  )}
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
          onClose={addModal.close}
          onSuccess={() => {
            addModal.close()
            fetchTeachers()
          }}
        />
      )}

      {transferModal.isOpen && (
        <Modal isOpen={true} onClose={transferModal.close} title="转移学校负责人" width="500px">
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '1rem' }}>
              选择新的学校负责人。转移后，您将失去学校负责人权限，新负责人将获得管理本校教师的权限。
            </p>
            <div style={formStyles.field}>
              <label style={formStyles.label}>选择新负责人 *</label>
              <select
                value={selectedNewPrincipal}
                onChange={(e) => setSelectedNewPrincipal(e.target.value)}
                style={formStyles.select}
              >
                <option value="">请选择</option>
                {transferableTeachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name} ({teacher.user.username})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={handleTransferPrincipal} disabled={transferring || !selectedNewPrincipal}>
              {transferring ? '转移中...' : '确认转移'}
            </Button>
            <Button variant="secondary" onClick={transferModal.close}>
              取消
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function TeacherFormModal({
  teacher,
  schoolId,
  onClose,
  onSuccess
}: {
  teacher: Teacher | null
  schoolId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [submitting, setSubmitting] = useState(false)

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
        alert('至少需要填写邮箱或手机号其中一个')
        return
      }

      setSubmitting(true)
      try {
        const url = teacher
          ? `http://localhost:3001/api/schools/current/teachers/${teacher.id}`
          : 'http://localhost:3001/api/schools/current/teachers'
        const method = teacher ? 'PUT' : 'POST'

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

        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
          },
          body: JSON.stringify(body)
        })

        const result = await res.json()
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
    <Modal isOpen={true} onClose={onClose} title={teacher ? '编辑教师' : '添加教师'} width="500px">
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
          <label style={formStyles.label}>用户名 *</label>
          <input
            type="text"
            value={form.values.username}
            onChange={(e) => form.handleChange('username', e.target.value)}
            required
            disabled={!!teacher}
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>密码 {!teacher && '*'}</label>
          <input
            type="password"
            value={form.values.password}
            onChange={(e) => form.handleChange('password', e.target.value)}
            required={!teacher}
            placeholder={teacher ? '留空则不修改' : ''}
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>职称</label>
          <input
            type="text"
            value={form.values.title}
            onChange={(e) => form.handleChange('title', e.target.value)}
            placeholder="如：高级教师"
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>邮箱 *</label>
          <input
            type="email"
            value={form.values.email}
            onChange={(e) => form.handleChange('email', e.target.value)}
            placeholder="如：teacher@example.com"
            style={formStyles.input}
          />
        </div>

        <div style={formStyles.field}>
          <label style={formStyles.label}>联系电话 *</label>
          <input
            type="tel"
            value={form.values.phone}
            onChange={(e) => form.handleChange('phone', e.target.value)}
            placeholder="如：13900000000"
            style={formStyles.input}
          />
        </div>

        <div style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>
          * 邮箱和电话至少填写一个
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
