'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import apiClient from '@/lib/apiClient'

interface TaskList {
  id: string
  title: string
  description: string | null
  publishAt: string | null
  deadline: string | null
  _count: { tasks: number }
}

interface Task {
  id: string
  title: string
  ojName: string | null
  problemId: string | null
  difficulty: string | null
  points: number | null
}

export default function TaskListsPage() {
  const router = useRouter()
  const { logout, user } = useAuth()
  const [taskLists, setTaskLists] = useState<TaskList[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedTaskList, setSelectedTaskList] = useState<TaskList | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])

  const isSuperAdmin = user?.role === 'super_admin'
  const isSchoolPrincipal = user?.role === 'school_principal'

  useEffect(() => {
    fetchTaskLists()
  }, [])

  const fetchTaskLists = async () => {
    try {
      const result = await apiClient.get<{ list: TaskList[] }>('/api/task-lists')
      if (result.success) {
        setTaskLists(result.data?.list || [])
      }
    } catch (error) {
      console.error('Failed to fetch task lists:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchClassGroups = async () => {
    try {
      const result = await apiClient.get<unknown[]>('/api/class-groups')
      if (result.success) {
        // Note: setClassGroups is not defined, this function appears unused
      }
    } catch (error) {
      console.error('Failed to fetch class groups:', error)
    }
  }

  const handleViewDetails = async (taskList: TaskList) => {
    setSelectedTaskList(taskList)
    try {
      const result = await apiClient.get<{ tasks: Task[] }>(`/api/task-lists/${taskList.id}`)
      if (result.success) {
        setTasks(result.data?.tasks || [])
      }
    } catch (error) {
      console.error('Failed to fetch task list:', error)
    }
    setShowDetailModal(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该题单吗？')) return
    try {
      const result = await apiClient.delete(`/api/task-lists/${id}`)
      if (result.success) {
        fetchTaskLists()
      } else {
        alert(result.message || '删除失败')
      }
    } catch {
      alert('删除失败')
    }
  }

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)

    try {
      const result = await apiClient.post('/api/task-lists', {
        title: formData.get('title'),
        description: formData.get('description') || null,
        publishAt: formData.get('publishAt') || null,
        deadline: formData.get('deadline') || null
      })
      if (result.success) {
        setShowModal(false)
        fetchTaskLists()
      } else {
        alert(result.message || '创建失败')
      }
    } catch {
      alert('创建失败')
    }
  }

  const difficultyColors: Record<string, string> = {
    '入门': '#22c55e',
    '简单': '#22c55e',
    '中等': '#f59e0b',
    '困难': '#ef4444',
    'hard': '#ef4444'
  }

  return (
    <ProtectedRoute requiredRole="teacher">
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        {/* 使用 AppShell 的统一导航 */}
        <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>题单管理</h2>
            <button onClick={() => setShowModal(true)} style={{ padding: '0.5rem 1rem', background: 'var(--primary)', color: 'white', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500 }}>+ 发布题单</button>
          </div>

          {loading ? (
            <p>加载中...</p>
          ) : taskLists.length === 0 ? (
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '3rem', textAlign: 'center', color: 'var(--gray-500)' }}>
              暂无题单
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--gray-50)' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>标题</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>题目数</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>发布时间</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>截止时间</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {taskLists.map(tl => (
                    <tr key={tl.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 500 }}>{tl.title}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{tl._count.tasks}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{tl.publishAt ? new Date(tl.publishAt).toLocaleDateString() : '-'}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{tl.deadline ? new Date(tl.deadline).toLocaleDateString() : '-'}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                        <button onClick={() => handleViewDetails(tl)} style={{ color: 'var(--primary)', marginRight: '1rem' }}>查看</button>
                        <button onClick={() => handleDelete(tl.id)} style={{ color: 'var(--error)' }}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 创建题单弹窗 */}
        {showModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', width: '100%', maxWidth: '500px' }}>
              <h3 style={{ marginBottom: '1.5rem', fontSize: '1.125rem', fontWeight: 600 }}>发布题单</h3>
              <form onSubmit={handleCreate} style={{ display: 'grid', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>标题 *</label>
                  <input name="title" required style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>发布时间</label>
                  <input name="publishAt" type="date" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>截止时间</label>
                  <input name="deadline" type="date" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.375rem', fontSize: '0.875rem' }}>描述</label>
                  <textarea name="description" rows={3} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                  <button type="submit" style={{ flex: 1, padding: '0.625rem', background: 'var(--primary)', color: 'white', borderRadius: '6px', fontWeight: 500 }}>发布</button>
                  <button type="button" onClick={() => setShowModal(false)} style={{ flex: 1, padding: '0.625rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'white' }}>取消</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 题单详情弹窗 */}
        {showDetailModal && selectedTaskList && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, overflow: 'auto' }}>
            <div style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', width: '100%', maxWidth: '700px', maxHeight: '90vh', overflow: 'auto' }}>
              <h3 style={{ marginBottom: '0.5rem', fontSize: '1.125rem', fontWeight: 600 }}>{selectedTaskList.title}</h3>
              {selectedTaskList.description && (
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)', marginBottom: '1rem' }}>{selectedTaskList.description}</p>
              )}

              <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--gray-600)' }}>
                {selectedTaskList.deadline && <span>截止: {new Date(selectedTaskList.deadline).toLocaleDateString()}</span>}
              </div>

              <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>题目列表</h4>
              {tasks.length === 0 ? (
                <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>暂无题目</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--gray-50)' }}>
                      <th style={{ padding: '0.5rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>#</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>题目</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>来源</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>难度</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>分值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task, index) => (
                      <tr key={task.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.5rem', fontSize: '0.875rem' }}>{index + 1}</td>
                        <td style={{ padding: '0.5rem', fontSize: '0.875rem' }}>{task.title}</td>
                        <td style={{ padding: '0.5rem', fontSize: '0.875rem' }}>{task.ojName} {task.problemId}</td>
                        <td style={{ padding: '0.5rem', fontSize: '0.875rem' }}>
                          {task.difficulty && (
                            <span style={{ padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', background: difficultyColors[task.difficulty] || 'var(--gray-100)', color: 'white' }}>
                              {task.difficulty}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '0.5rem', fontSize: '0.875rem' }}>{task.points || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <button onClick={() => setShowDetailModal(false)} style={{ marginTop: '1.5rem', width: '100%', padding: '0.625rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'white' }}>关闭</button>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}
