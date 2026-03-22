'use client'

import { useEffect, useState } from 'react'
import { Table } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Pagination } from '@/components/ui/Pagination'
import { getAuthHeaders } from '@/lib/auth'

interface UserManagementProps {
  // API 配置
  fetchUrl: string // 获取用户列表的 API URL

  // 权限配置
  canCreate?: boolean // 是否可以创建用户
  canEdit?: boolean // 是否可以编辑用户
  canDelete?: boolean // 是否可以删除用户
  canToggleStatus?: boolean // 是否可以启用/禁用用户
  canResetPassword?: boolean // 是否可以重置密码

  // 筛选配置
  showRoleFilter?: boolean // 是否显示角色筛选
  showStatusFilter?: boolean // 是否显示状态筛选
  showKeywordSearch?: boolean // 是否显示关键词搜索

  // 列配置
  columns?: string[] // 要显示的列，默认全部显示

  // 回调
  onCreateClick?: () => void
  onEditClick?: (user: any) => void
  onDeleteClick?: (user: any) => void
}

export function UserManagement({
  fetchUrl,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  canToggleStatus = false,
  canResetPassword = false,
  showRoleFilter = false,
  showStatusFilter = true,
  showKeywordSearch = true,
  columns = ['username', 'name', 'role', 'school', 'status', 'contact', 'createdAt'],
  onCreateClick,
  onEditClick,
  onDeleteClick
}: UserManagementProps) {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    role: '',
    status: '',
    keyword: ''
  })
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0
  })

  useEffect(() => {
    fetchUsers()
  }, [pagination.page, pagination.pageSize])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.role) params.append('role', filters.role)
      if (filters.status) params.append('status', filters.status)
      if (filters.keyword) params.append('keyword', filters.keyword)
      params.append('page', pagination.page.toString())
      params.append('pageSize', pagination.pageSize.toString())

      const url = fetchUrl.includes('?')
        ? `${fetchUrl}&${params.toString()}`
        : `${fetchUrl}?${params.toString()}`

      const res = await fetch(url, {
        headers: getAuthHeaders()
      })
      const data = await res.json()

      if (data.success) {
        // 兼容不同的响应格式
        const userData = data.data.users || data.data || []
        setUsers(userData)

        if (data.data.page !== undefined) {
          setPagination({
            page: data.data.page,
            pageSize: data.data.pageSize,
            total: data.data.total,
            totalPages: data.data.totalPages
          })
        }
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (user: any) => {
    const newPassword = prompt(`为用户 ${user.username || user.user?.username} 设置新密码（至少6位）:`)
    if (!newPassword) return
    if (newPassword.length < 6) {
      alert('密码长度至少为6位')
      return
    }

    try {
      const res = await fetch(`http://localhost:3001/api/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ newPassword, resetMethod: 'manual_set' })
      })
      const data = await res.json()
      if (data.success) {
        alert('密码重置成功')
      } else {
        alert(data.message || '重置失败')
      }
    } catch {
      alert('操作失败')
    }
  }

  const handleToggleStatus = async (user: any) => {
    const currentStatus = user.status || user.user?.status
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
    const username = user.username || user.user?.username || user.name

    if (!confirm(`确定要${newStatus === 'disabled' ? '禁用' : '启用'}用户 ${username} 吗？`)) return

    try {
      const res = await fetch(`http://localhost:3001/api/users/${user.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ status: newStatus })
      })
      const data = await res.json()
      if (data.success) {
        fetchUsers()
      } else {
        alert(data.message || '操作失败')
      }
    } catch {
      alert('操作失败')
    }
  }

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      super_admin: '超级管理员',
      platform_admin: '平台管理员',
      school_principal: '学校负责人',
      teacher: '教师',
      student: '学生'
    }
    return labels[role] || role
  }

  const handlePageChange = (page: number) => {
    setPagination(prev => ({ ...prev, page }))
  }

  const handlePageSizeChange = (pageSize: number) => {
    setPagination(prev => ({ ...prev, page: 1, pageSize }))
  }

  const handleSearch = () => {
    setPagination(prev => ({ ...prev, page: 1 }))
    fetchUsers()
  }

  // 构建表格列配置
  const tableColumns = []

  if (columns.includes('username')) {
    tableColumns.push({
      key: 'username',
      label: '用户名',
      render: (user: any) => user.username || user.user?.username || '-'
    })
  }

  if (columns.includes('name')) {
    tableColumns.push({
      key: 'name',
      label: '姓名',
      render: (user: any) => user.name || user.profile?.name || '-'
    })
  }

  if (columns.includes('role')) {
    tableColumns.push({
      key: 'role',
      label: '角色',
      render: (user: any) => getRoleLabel(user.role || user.user?.role || '')
    })
  }

  if (columns.includes('school')) {
    tableColumns.push({
      key: 'school',
      label: '学校',
      render: (user: any) => user.profile?.schoolName || user.school?.name || '-'
    })
  }

  if (columns.includes('status')) {
    tableColumns.push({
      key: 'status',
      label: '状态',
      render: (user: any) => {
        const status = user.status || user.user?.status
        return (
          <Badge variant={status === 'active' ? 'success' : 'error'}>
            {status === 'active' ? '正常' : '禁用'}
          </Badge>
        )
      }
    })
  }

  if (columns.includes('contact')) {
    tableColumns.push({
      key: 'contact',
      label: '联系方式',
      render: (user: any) => {
        const contacts = []
        if (user.email) contacts.push(user.email)
        if (user.phone) contacts.push(user.phone)
        return contacts.length > 0 ? contacts.join(' / ') : '-'
      }
    })
  }

  if (columns.includes('createdAt')) {
    tableColumns.push({
      key: 'createdAt',
      label: '创建时间',
      render: (user: any) => new Date(user.createdAt).toLocaleDateString()
    })
  }

  return (
    <div>
      {/* 顶部操作栏 */}
      {canCreate && onCreateClick && (
        <div style={{ marginBottom: '1rem' }}>
          <Button onClick={onCreateClick}>+ 创建用户</Button>
        </div>
      )}

      {/* 筛选器 */}
      {(showRoleFilter || showStatusFilter || showKeywordSearch) && (
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            {showRoleFilter && (
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>角色</label>
                <select
                  value={filters.role}
                  onChange={(e) => setFilters({ ...filters, role: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px' }}
                >
                  <option value="">全部</option>
                  <option value="super_admin">超级管理员</option>
                  <option value="platform_admin">平台管理员</option>
                  <option value="school_principal">学校负责人</option>
                  <option value="teacher">教师</option>
                  <option value="student">学生</option>
                </select>
              </div>
            )}

            {showStatusFilter && (
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>状态</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px' }}
                >
                  <option value="">全部</option>
                  <option value="active">正常</option>
                  <option value="disabled">禁用</option>
                </select>
              </div>
            )}

            {showKeywordSearch && (
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>搜索</label>
                <input
                  type="text"
                  placeholder="用户名"
                  value={filters.keyword}
                  onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px' }}
                />
              </div>
            )}
          </div>
          <Button onClick={handleSearch} style={{ marginTop: '1rem' }}>
            查询
          </Button>
        </div>
      )}

      {/* 表格 */}
      <Table
        data={users}
        loading={loading}
        emptyText="暂无数据"
        columns={tableColumns}
        actions={(user) => (
          <>
            {canEdit && onEditClick && (
              <Button variant="text" onClick={() => onEditClick(user)}>
                编辑
              </Button>
            )}
            {canResetPassword && (
              <Button variant="text" onClick={() => handleResetPassword(user)}>
                重置密码
              </Button>
            )}
            {canToggleStatus && (
              <Button
                variant="text"
                onClick={() => handleToggleStatus(user)}
                style={{ color: (user.status || user.user?.status) === 'active' ? 'var(--error)' : 'var(--success)' }}
              >
                {(user.status || user.user?.status) === 'active' ? '禁用' : '启用'}
              </Button>
            )}
            {canDelete && onDeleteClick && (
              <Button
                variant="text"
                onClick={() => onDeleteClick(user)}
                style={{ color: 'var(--error)' }}
              >
                删除
              </Button>
            )}
          </>
        )}
      />

      {/* 分页 */}
      {pagination.totalPages > 1 && (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
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
