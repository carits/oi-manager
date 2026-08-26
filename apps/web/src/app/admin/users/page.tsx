'use client'

import { useEffect, useState } from 'react'
import collisionStyles from './page.collision.module.css'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import unifiedStyles from './page.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
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

export default function AdminUsersPage() {
  const router = useRouter()
  const { user: currentUser } = useAuth()
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
    fetchUsers()
  }, [pagination.page, pagination.pageSize])

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

  return (
    <>
      <div className={unifiedStyles.u1}>
        <main className={unifiedStyles.u2}>
          <div className={unifiedStyles.u3}>
            <h2 className={unifiedStyles.u4}>账号管理</h2>
            {currentUser?.role === 'super_admin' && (
              <Button variant="ghost"
                onClick={() => router.push('/admin/users/new-platform-admin')}
                className={unifiedStyles.u5}
              >
                + 创建平台管理员
              </Button>
            )}
          </div>

          {/* 筛选器 */}
          <div className={unifiedStyles.u6}>
            <div className={unifiedStyles.u7}>
              <div>
                <label className={unifiedStyles.u8}>角色</label>
                <Select aria-label="选择"
                  value={filters.role}
                  onChange={(e) => setFilters({ ...filters, role: e.target.value })}
                  className={unifiedStyles.u9}
                >
                  <option value="">全部</option>
                  <option value="super_admin">超级管理员</option>
                  <option value="platform_admin">平台管理员</option>
                  <option value="school_principal">学校负责人</option>
                  <option value="teacher">教师</option>
                  <option value="student">学生</option>
                </Select>
              </div>
              <div>
                <label className={unifiedStyles.u8}>状态</label>
                <Select aria-label="选择"
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className={unifiedStyles.u9}
                >
                  <option value="">全部</option>
                  <option value="active">正常</option>
                  <option value="disabled">禁用</option>
                </Select>
              </div>
              <div>
                <label className={unifiedStyles.u8}>搜索</label>
                <Input
                  type="text"
                  placeholder="用户名"
                  value={filters.keyword}
                  onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
                  className={unifiedStyles.u9}
                />
              </div>
            </div>
            <Button variant="ghost"
              onClick={handleSearch}
              className={unifiedStyles.u10}
            >
              查询
            </Button>
          </div>

          {loading ? (
            <p><span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></p>
          ) : error ? (
            <div className={unifiedStyles.u11}>
              {error}
            </div>
          ) : (
            <div className={unifiedStyles.u12}>
              <TableRoot className={unifiedStyles.u13}>
                <TableHead>
                  <TableRow className={unifiedStyles.u14}>
                    <TableHeaderCell className={unifiedStyles.u15}>用户名</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u15}>姓名</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u15}>角色</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u15}>学校</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u15}>状态</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u15}>创建时间</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u15}>操作</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className={unifiedStyles.u16}>
                        暂无用户数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((user) => (
                      <TableRow key={user.id} className={unifiedStyles.u17}>
                        <TableCell className={unifiedStyles.u18}>{user.username}</TableCell>
                        <TableCell className={unifiedStyles.u19}>{user.profile?.name || '-'}</TableCell>
                        <TableCell className={unifiedStyles.u19}>{getRoleLabel(user.role)}</TableCell>
                        <TableCell className={unifiedStyles.u19}>{user.profile?.schoolName || '-'}</TableCell>
                        <TableCell className={unifiedStyles.u19}>
                          <span className={`${unifiedStyles.statusBadge} ${user.status === 'active' ? unifiedStyles.statusActive : unifiedStyles.statusInactive}`}>
                            {user.status === 'active' ? '正常' : '禁用'}
                          </span>
                        </TableCell>
                        <TableCell className={unifiedStyles.u19}>
                          {new Date(user.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className={unifiedStyles.u19}>
                          <a
                            href={`/admin/users/${user.id}`}
                            className={unifiedStyles.u20}
                          >
                            查看
                          </a>
                          <Button variant="ghost"
                            onClick={() => handleResetPassword(user.id, user.username)}
                            className={unifiedStyles.u21}
                          >
                            重置密码
                          </Button>
                          <Button variant="text"
                            onClick={() => handleToggleStatus(user.id, user.status, user.username)}
                            className={user.status === 'active' ? unifiedStyles.toggleDanger : unifiedStyles.toggleSuccess}
                          >
                            {user.status === 'active' ? '禁用' : '启用'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </TableRoot>

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
    </>
  )
}
