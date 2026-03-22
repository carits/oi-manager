'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import apiClient from '@/lib/apiClient'
import { getUserId } from '@/lib/auth'

interface TaskList {
  id: string
  title: string
  description: string | null
  publishAt: string | null
  deadline: string | null
}

interface Task {
  id: string
  title: string
  ojName: string | null
  problemId: string | null
  difficulty: string | null
  points: number | null
  progress: {
    id: string
    status: string
    seenEditorial: boolean
    needHelp: boolean
    notes: string | null
  } | null
}

interface ProgressData {
  taskListId: string
  totalTasks: number
  completedTasks: number
  reviewingTasks: number
  tasks: Task[]
}

export default function StudentTaskListsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const { logout, user } = useAuth()
  const [taskLists, setTaskLists] = useState<TaskList[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTaskList, setSelectedTaskList] = useState<TaskList | null>(null)
  const [progressData, setProgressData] = useState<ProgressData | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    fetchTaskLists()
  }, [])

  const fetchTaskLists = async () => {
    try {
      const result = await apiClient.get<{ list: TaskList[] }>('/api/task-lists')
      if (result.success) {
        const published = (result.data?.list || []).filter((tl: TaskList) => tl.publishAt === null || new Date(tl.publishAt) <= new Date())
        setTaskLists(published)
      }
    } catch (error) {
      console.error('Failed to fetch task lists:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleViewDetails = async (taskList: TaskList) => {
    setSelectedTaskList(taskList)
    const userId = getUserId()
    if (!userId) return

    try {
      const result = await apiClient.get<ProgressData>(`/api/task-progress?taskListId=${taskList.id}&studentId=${userId}`)
      if (result.success) {
        setProgressData(result.data || null)
      }
    } catch (error) {
      console.error('Failed to fetch progress:', error)
    }
    setShowModal(true)
  }

  const updateProgress = async (taskId: string, status: string) => {
    const userId = getUserId()
    if (!userId) return

    setUpdating(taskId)
    try {
      const result = await apiClient.put('/api/task-progress', {
        taskId,
        studentId: userId,
        status
      })
      if (result.success) {
        // 刷新进度
        if (selectedTaskList) {
          handleViewDetails(selectedTaskList)
        }
      }
    } catch (error) {
      console.error('Failed to update progress:', error)
    }
    setUpdating(null)
  }

  const toggleSeenEditorial = async (taskId: string, currentValue: boolean) => {
    const userId = getUserId()
    if (!userId) return

    try {
      const result = await apiClient.put('/api/task-progress', {
        taskId,
        studentId: userId,
        seenEditorial: !currentValue
      })
      if (result.success && selectedTaskList) {
        handleViewDetails(selectedTaskList)
      }
    } catch (error) {
      console.error('Failed to update:', error)
    }
  }

  const toggleNeedHelp = async (taskId: string, currentValue: boolean) => {
    const userId = getUserId()
    if (!userId) return

    try {
      const result = await apiClient.put('/api/task-progress', {
        taskId,
        studentId: userId,
        needHelp: !currentValue
      })
      if (result.success && selectedTaskList) {
        handleViewDetails(selectedTaskList)
      }
    } catch (error) {
      console.error('Failed to update:', error)
    }
  }

  const difficultyColors: Record<string, string> = {
    '入门': '#22c55e',
    '简单': '#22c55e',
    '中等': '#f59e0b',
    '困难': '#ef4444',
    'hard': '#ef4444'
  }

  const statusColors: Record<string, { bg: string; text: string }> = {
    pending: { bg: 'var(--gray-100)', text: 'var(--gray-600)' },
    done: { bg: '#dcfce7', text: '#16a34a' },
    review: { bg: '#fef3c7', text: '#d97706' }
  }

  const statusLabels: Record<string, string> = {
    pending: '未开始',
    done: '已完成',
    review: '待复习'
  }

  const isOverdue = (deadline: string | null) => {
    if (!deadline) return false
    return new Date(deadline) < new Date()
  }

  return (
    <ProtectedRoute requiredRole="student">
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        {/* 使用 AppShell 的统一导航 */}
        <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
          {/* Tab 导航：在我的题单和我的比赛之间切换 */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
            <Link href="/student/task-lists" style={{ padding: '0.5rem 1rem', background: pathname === '/student/task-lists' ? 'var(--primary)' : 'transparent', color: pathname === '/student/task-lists' ? 'white' : 'var(--gray-600)', borderRadius: '6px 6px 0 0', fontSize: '0.875rem', fontWeight: pathname === '/student/task-lists' ? 500 : 400, textDecoration: 'none' }}>我的题单</Link>
            <Link href="/student/contests" style={{ padding: '0.5rem 1rem', background: pathname === '/student/contests' ? 'var(--primary)' : 'transparent', color: pathname === '/student/contests' ? 'white' : 'var(--gray-600)', borderRadius: '6px 6px 0 0', fontSize: '0.875rem', fontWeight: pathname === '/student/contests' ? 500 : 400, textDecoration: 'none' }}>我的比赛</Link>
          </div>

          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>我的题单</h2>

          {loading ? (
            <p>加载中...</p>
          ) : taskLists.length === 0 ? (
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '3rem', textAlign: 'center', color: 'var(--gray-500)' }}>
              暂无题单
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {taskLists.map(taskList => (
                <div
                  key={taskList.id}
                  onClick={() => handleViewDetails(taskList)}
                  style={{
                    background: 'white',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    padding: '1.5rem',
                    cursor: 'pointer',
                    borderLeft: taskList.deadline && isOverdue(taskList.deadline) ? '4px solid var(--error)' : '1px solid var(--border)',
                    transition: 'box-shadow 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>{taskList.title}</h3>
                      {taskList.description && (
                        <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)', marginBottom: '0.5rem' }}>{taskList.description}</p>
                      )}
                      <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                        {taskList.deadline && (
                          <span style={{ color: isOverdue(taskList.deadline) ? 'var(--error)' : 'var(--gray-500)' }}>
                            截止：{new Date(taskList.deadline).toLocaleDateString()}
                            {isOverdue(taskList.deadline) && '（已逾期）'}
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={{ color: 'var(--primary)', fontSize: '0.875rem' }}>查看题目 →</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 题单详情弹窗 */}
        {showModal && selectedTaskList && progressData && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, overflow: 'auto' }}>
            <div style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', width: '100%', maxWidth: '900px', maxHeight: '90vh', overflow: 'auto' }}>
              <h3 style={{ marginBottom: '0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>{selectedTaskList.title}</h3>
              {selectedTaskList.description && (
                <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)', marginBottom: '1rem' }}>{selectedTaskList.description}</p>
              )}

              {/* 进度统计 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem', padding: '1rem', background: 'var(--gray-50)', borderRadius: '8px' }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '1.5rem', fontWeight: 600 }}>{progressData.totalTasks}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>总题数</p>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '1.5rem', fontWeight: 600, color: '#16a34a' }}>{progressData.completedTasks}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>已完成</p>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '1.5rem', fontWeight: 600, color: '#d97706' }}>{progressData.reviewingTasks}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>待复习</p>
                </div>
              </div>

              <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>题目列表</h4>
              {progressData.tasks.length === 0 ? (
                <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>暂无题目</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--gray-50)' }}>
                      <th style={{ padding: '0.5rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500 }}>状态</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500 }}>题目</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500 }}>来源</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500 }}>难度</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {progressData.tasks.map(task => {
                      const status = task.progress?.status || 'pending'
                      const colors = statusColors[status]
                      return (
                        <tr key={task.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: '0.5rem' }}>
                            <span style={{ padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', background: colors.bg, color: colors.text }}>
                              {statusLabels[status]}
                            </span>
                          </td>
                          <td style={{ padding: '0.5rem', fontSize: '0.875rem' }}>{task.title}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.875rem' }}>{task.ojName} {task.problemId}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.875rem' }}>
                            {task.difficulty && (
                              <span style={{ padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', background: difficultyColors[task.difficulty] || 'var(--gray-100)', color: 'white' }}>
                                {task.difficulty}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '0.5rem', fontSize: '0.75rem' }}>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              {status === 'pending' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateProgress(task.id, 'done') }}
                                  disabled={updating === task.id}
                                  style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #16a34a', color: '#16a34a', background: 'white', fontSize: '0.75rem' }}
                                >
                                  完成
                                </button>
                              )}
                              {status === 'done' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateProgress(task.id, 'review') }}
                                  disabled={updating === task.id}
                                  style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #d97706', color: '#d97706', background: 'white', fontSize: '0.75rem' }}
                                >
                                  待复习
                                </button>
                              )}
                              {status === 'review' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); updateProgress(task.id, 'done') }}
                                  disabled={updating === task.id}
                                  style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #16a34a', color: '#16a34a', background: 'white', fontSize: '0.75rem' }}
                                >
                                  已掌握
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleSeenEditorial(task.id, task.progress?.seenEditorial || false) }}
                                style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: task.progress?.seenEditorial ? '1px solid var(--primary)' : '1px solid var(--border)', color: task.progress?.seenEditorial ? 'var(--primary)' : 'var(--gray-500)', background: task.progress?.seenEditorial ? '#eff6ff' : 'white', fontSize: '0.75rem' }}
                              >
                                看题解
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleNeedHelp(task.id, task.progress?.needHelp || false) }}
                                style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', border: task.progress?.needHelp ? '1px solid var(--error)' : '1px solid var(--border)', color: task.progress?.needHelp ? 'var(--error)' : 'var(--gray-500)', background: task.progress?.needHelp ? '#fef2f2' : 'white', fontSize: '0.75rem' }}
                              >
                                需要讲解
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              <button onClick={() => setShowModal(false)} style={{ marginTop: '1.5rem', width: '100%', padding: '0.625rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'white' }}>关闭</button>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}
