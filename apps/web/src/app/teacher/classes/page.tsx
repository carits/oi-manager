'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import apiClient from '@/lib/apiClient'
import { getAuthHeaders } from '@/lib/auth'

interface ClassGroup {
  id: string
  name: string
  level: string | null
  description: string | null
  teacher: { name: string } | null
  _count: { students: number }
}

export default function ClassesPage() {
  const router = useRouter()
  const toast = useToast()
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingClass, setEditingClass] = useState<ClassGroup | null>(null)
  const [confirmState, setConfirmState] = useState<{ id: string; message: string; action: () => Promise<void> } | null>(null)


  useEffect(() => {
    // 班级管理已废弃，重定向到团队管理
    router.push('/teacher/teams')
  }, [router])

  // 暂时保留-fetchClassGroups-功能兼容
  /*
  useEffect(() => {
    fetchClassGroups()
  }, [])
  */

  const fetchClassGroups = async () => {
    try {
      const result = await apiClient.get<ClassGroup[]>('/api/class-groups')
      if (result.success) {
        setClassGroups(result.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch class groups:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    setConfirmState({
      id,
      message: '确定要删除该班级吗？',
      action: async () => {
        try {
          const result = await apiClient.delete(`/api/class-groups/${id}`)
          if (result.success) {
            fetchClassGroups()
          } else {
            toast.error(result.message || '删除失败')
          }
        } catch {
          toast.error('删除失败')
        }
      }
    })
  }

  const handleEdit = (classGroup: ClassGroup) => {
    setEditingClass(classGroup)
    setShowModal(true)
  }

  const handleAdd = () => {
    setEditingClass(null)
    setShowModal(true)
  }

  const handleSuccess = () => {
    setShowModal(false)
    setEditingClass(null)
    fetchClassGroups()
  }

  return (
    <ProtectedRoute requiredRole="teacher">
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>班级管理</h2>
          <button
            onClick={handleAdd}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--primary)',
              color: 'white',
              borderRadius: '6px',
              fontSize: '0.875rem',
              fontWeight: 500
            }}
          >
            + 添加班级
          </button>
        </div>

        {/* 列表 */}
        {loading ? (
          <p>加载中...</p>
        ) : (
          <div style={{
            background: 'white',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            overflow: 'hidden'
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>班级名称</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>级别</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>人数</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>描述</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {classGroups.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>
                      暂无班级数据
                    </td>
                  </tr>
                ) : classGroups.map(cg => (
                  <tr key={cg.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 500 }}>{cg.name}</td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{cg.level || '-'}</td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{cg._count.students}</td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{cg.description || '-'}</td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                      <button
                        onClick={() => handleEdit(cg)}
                        style={{ color: 'var(--primary)', marginRight: '1rem' }}
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(cg.id)}
                        style={{ color: 'var(--error)' }}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 确认删除弹窗 */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={() => { confirmState?.action(); setConfirmState(null) }}
        title="确认操作"
        message={confirmState?.message || ''}
        confirmText="确认"
        variant="danger"
      />

      {/* 添加/编辑弹窗 */}
      {showModal && (
        <ClassGroupModal
          classGroup={editingClass}
          onClose={() => setShowModal(false)}
          onSuccess={handleSuccess}
        />
      )}
    </ProtectedRoute>
  )
}

// 班级表单弹窗组件
function ClassGroupModal({
  classGroup,
  onClose,
  onSuccess
}: {
  classGroup: ClassGroup | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [formData, setFormData] = useState({
    name: classGroup?.name || '',
    level: classGroup?.level || '',
    description: classGroup?.description || ''
  })
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const data = {
      name: formData.name,
      level: formData.level || null,
      description: formData.description || null
    }

    try {
      const url = classGroup ? `/api/class-groups/${classGroup.id}` : '/api/class-groups'
      const method = classGroup ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(data)
      })

      const result = await res.json()
      if (result.success) {
        onSuccess()
      } else {
        toast.error(result.message || '操作失败')
      }
    } catch {
      toast.error('操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '1.5rem',
        width: '100%',
        maxWidth: '500px'
      }}>
        <h3 style={{ marginBottom: '1.5rem', fontSize: '1.125rem', fontWeight: 600 }}>
          {classGroup ? '编辑班级' : '添加班级'}
        </h3>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>班级名称 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>级别</label>
            <select
              value={formData.level}
              onChange={(e) => setFormData({ ...formData, level: e.target.value })}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }}
            >
              <option value="">请选择</option>
              <option value="入门班">入门班</option>
              <option value="基础班">基础班</option>
              <option value="提高班">提高班</option>
              <option value="竞赛班">竞赛班</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>描述</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button
              type="submit"
              disabled={loading}
              style={{
                flex: 1,
                padding: '0.625rem',
                background: 'var(--primary)',
                color: 'white',
                borderRadius: '6px',
                fontWeight: 500
              }}
            >
              {loading ? '保存中...' : '保存'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                padding: '0.625rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'white'
              }}
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
