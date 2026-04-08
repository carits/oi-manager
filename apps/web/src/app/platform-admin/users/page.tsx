'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { getRole } from '@/lib/auth'
import { Pagination } from '@/components/ui/Pagination'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { PasswordResetModal } from '@/components/ui/PasswordResetModal'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'

interface User {
  id: string
  username: string
  role: string
  status: string
  createdAt: string
  profile?: {
    name: string
    schoolName?: string
  }
}

export default function PlatformAdminUsersPage() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
  const [resetTarget, setResetTarget] = useState<{ id: string; username: string } | null>(null)
  const [toggleConfirm, setToggleConfirm] = useState<{ userId: string; newStatus: string; username: string } | null>(null)

  useEffect(() => {
    setMounted(true)
    setRole(getRole())
  }, [])

  useEffect(() => {
    if (mounted) {
      fetchUsers()
    }
  }, [mounted, pagination.page, pagination.pageSize])

  const fetchUsers = async () => {
    try {
      const params = new URLSearchParams()
      if (filters.role) params.append('role', filters.role)
      if (filters.status) params.append('status', filters.status)
      if (filters.keyword) params.append('keyword', filters.keyword)
      params.append('page', pagination.page.toString())
      params.append('pageSize', pagination.pageSize.toString())

      const result = await apiClient.get<{ users: User[]; page: number; pageSize: number; total: number; totalPages: number }>(`/api/users?${params.toString()}`)
      if (result.success) {
        setUsers(result.data?.users || [])
        if (result.data) {
          setPagination({
            page: result.data.page,
            pageSize: result.data.pageSize,
            total: result.data.total,
            totalPages: result.data.totalPages
          })
        }
      } else {
        setError(result.message || '加载失败')
      }
    } catch (e) {
      setError('网络错误')
      console.error('Fetch users error:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = (userId: string, username: string) => {
    setResetTarget({ id: userId, username })
  }

  const handleToggleStatus = (userId: string, currentStatus: string, username: string) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active'
    setToggleConfirm({ userId, newStatus, username })
  }

  const confirmToggleStatus = async () => {
    if (!toggleConfirm) return
    const { userId, newStatus } = toggleConfirm

    try {
      const result = await apiClient.put(`/api/users/${userId}/status`, { status: newStatus, reason: '' })
      if (result.success) {
        toast.success('状态更新成功')
        fetchUsers()
      } else {
        toast.error(result.message || '更新失败')
      }
    } catch (e) {
      toast.error('网络错误')
      console.error('Toggle status error:', e)
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

  if (!mounted) {
    return (
      <ProtectedRoute requiredRole="platform_admin">
        <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>
          加载中...
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute requiredRole="platform_admin">
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>账号管理</h2>
          </div>

          {/* 筛选器 */}
          <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', border: '1px solid var(--border)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.5rem' }}>角色</label>
                <select
                  value={filters.role}
                  onChange={(e) => setFilters({ ...filters, role: e.target.value })}
                  style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px' }}
                >
                  <option value="">全部</option>
                  <option value="school_principal">学校负责人</option>
                  <option value="teacher">教师</option>
                  <option value="student">学生</option>
                </select>
              </div>
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
            </div>
            <button
              onClick={handleSearch}
              style={{
                marginTop: '1rem',
                padding: '0.5rem 1rem',
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              查询
            </button>
          </div>

          {loading ? (
            <p>加载中...</p>
          ) : error ? (
            <div style={{ padding: '1rem', background: '#fee2e2', borderRadius: '6px', color: '#991b1b' }}>
              {error}
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, fontSize: '0.875rem' }}>用户名</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, fontSize: '0.875rem' }}>姓名</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, fontSize: '0.875rem' }}>角色</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, fontSize: '0.875rem' }}>学校</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, fontSize: '0.875rem' }}>状态</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, fontSize: '0.875rem' }}>创建时间</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: 500, fontSize: '0.875rem' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>
                        暂无用户数据
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 500 }}>{user.username}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{user.profile?.name || '-'}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{getRoleLabel(user.role)}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{user.profile?.schoolName || '-'}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            background: user.status === 'active' ? '#dcfce7' : '#fee2e2',
                            color: user.status === 'active' ? '#166534' : '#991b1b'
                          }}>
                            {user.status === 'active' ? '正常' : '禁用'}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                          <a
                            href={`/admin/users/${user.id}`}
                            style={{ color: 'var(--primary)', marginRight: '0.5rem' }}
                          >
                            查看
                          </a>
                          <button
                            onClick={() => handleResetPassword(user.id, user.username)}
                            style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', marginRight: '0.5rem' }}
                          >
                            重置密码
                          </button>
                          <button
                            onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                            style={{ color: user.status === 'active' ? '#dc2626' : '#16a34a', background: 'none', border: 'none', cursor: 'pointer' }}
                          >
                            {user.status === 'active' ? '禁用' : '启用'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {/* 分页组件 */}
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
            </div>
          )}
        </main>

        {/* 重置密码弹窗 */}
        {resetTarget && (
          <PasswordResetModal
            isOpen={true}
            onClose={() => setResetTarget(null)}
            userId={resetTarget.id}
            username={resetTarget.username}
            onSuccess={() => {
              toast.success('密码重置成功')
              setResetTarget(null)
            }}
          />
        )}

        {/* 禁用/启用确认弹窗 */}
        <ConfirmModal
          isOpen={!!toggleConfirm}
          onClose={() => setToggleConfirm(null)}
          onConfirm={confirmToggleStatus}
          title={toggleConfirm?.newStatus === 'disabled' ? '禁用用户' : '启用用户'}
          message={`确定要${toggleConfirm?.newStatus === 'disabled' ? '禁用' : '启用'}用户 ${toggleConfirm?.username || ''} 吗？`}
          confirmText="确认"
          danger={toggleConfirm?.newStatus === 'disabled'}
        />
      </div>
    </ProtectedRoute>
  )
}
