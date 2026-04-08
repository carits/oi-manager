'use client'

import { useEffect, useState, useCallback } from 'react'
import { Table } from '@/components/ui/Table'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Pagination } from '@/components/ui/Pagination'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { PasswordResetModal } from '@/components/ui/PasswordResetModal'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'

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

  // 弹窗状态
  const toast = useToast()
  const [resetUser, setResetUser] = useState<{ id: string; username: string } | null>(null)
  const [toggleConfirm, setToggleConfirm] = useState<{ user: any; newStatus: string } | null>(null)

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

      const result = await apiClient.get<{ users?: any[]; page?: number; pageSize?: number; total?: number; totalPages?: number } | any[]>(url)

      if (result.success) {
        // 兼容不同的响应格式
        const userData = result.data?.users || result.data || []
        setUsers(Array.isArray(userData) ? userData : [])

        if (result.data && !Array.isArray(result.data) && result.data.page !== undefined) {
          setPagination({
            page: result.data.page,
            pageSize: result.data.pageSize,
            total: result.data.total,
            totalPages: result.data.totalPages
          })
        }
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = (user: any) => {
    setResetUser({ id: user.id, username: user.username || user.user?.username })
  }

  const handleResetSuccess = (newPassword: string) => {
    toast.success('密码重置成功')
    setResetUser(null)
  }

  const handleToggleStatus = async (user: any) => {
    const currentStatus = user.status || user.user?.status
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
    setToggleConfirm({ user, newStatus })
  }

  const confirmToggleStatus = async () => {
    if (!toggleConfirm) return
    const { user, newStatus } = toggleConfirm

    try {
      const result = await apiClient.put(`/api/users/${user.id}/status`, { status: newStatus })
      if (result.success) {
        toast.success(`用户已${newStatus === 'disabled' ? '禁用' : '启用'}`)
        fetchUsers()
      } else {
        toast.error(result.message || '操作失败')
      }
    } catch {
      toast.error('操作失败')
    } finally {
      setToggleConfirm(null)
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
      {/* 重置密码弹窗 */}
      {resetUser && (
        <PasswordResetModal
          isOpen={true}
          onClose={() => setResetUser(null)}
          userId={resetUser.id}
          username={resetUser.username}
          onSuccess={() => {
            toast.success('密码重置成功')
            setResetUser(null)
          }}
        />
      )}

      {/* 禁用/启用确认弹窗 */}
      <ConfirmModal
        isOpen={!!toggleConfirm}
        onClose={() => setToggleConfirm(null)}
        onConfirm={confirmToggleStatus}
        title={toggleConfirm?.newStatus === 'disabled' ? '禁用用户' : '启用用户'}
        message={`确定要${toggleConfirm?.newStatus === 'disabled' ? '禁用' : '启用'}用户 ${toggleConfirm?.user?.username || toggleConfirm?.user?.user?.username || toggleConfirm?.user?.name} 吗？`}
        confirmText="确认"
        danger={toggleConfirm?.newStatus === 'disabled'}
      />
    </div>
  )
}
