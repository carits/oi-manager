'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Table } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'

interface Contest {
  id: string
  title: string
  description: string | null
  contestDate: string
  status: string
  type: string // training / official / mock
  countRating: boolean
  teamId: string | null
  team: { id: string; name: string } | null
  creator: { username: string } | null
  _count: { resources: number }
}

export default function ContestsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const [contests, setContests] = useState<Contest[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>('')

  useEffect(() => {
    fetchContests()
  }, [typeFilter])

  const fetchContests = async () => {
    setLoading(true)
    try {
      const endpoint = typeFilter ? `/api/contests?type=${typeFilter}` : '/api/contests'
      const result = await apiClient.get<Contest[]>(endpoint)
      if (result.success) {
        setContests(result.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch contests:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除该比赛吗？')) return

    try {
      const result = await apiClient.delete(`/api/contests/${id}`)
      if (result.success) {
        fetchContests()
      } else {
        alert(result.message || '删除失败')
      }
    } catch {
      alert('删除失败')
    }
  }

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      training: '训练赛',
      official: '正赛',
      mock: '模拟赛'
    }
    return labels[type] || type
  }

  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      training: '#3b82f6',
      official: '#8b5cf6',
      mock: '#f59e0b'
    }
    return colors[type] || '#6b7280'
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      upcoming: '未开始',
      ongoing: '进行中',
      ended: '已结束'
    }
    return labels[status] || status
  }

  return (
    <ProtectedRoute requiredRole="teacher">
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
        <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
          <PageHeader title="比赛管理">
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={{
                  padding: '0.375rem 0.75rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  fontSize: '0.875rem'
                }}
              >
                <option value="">全部类型</option>
                <option value="training">训练赛</option>
                <option value="official">正赛</option>
                <option value="mock">模拟赛</option>
              </select>
              <Button onClick={() => router.push('/teacher/contests/new')}>+ 创建比赛</Button>
            </div>
          </PageHeader>

          <Table
            data={contests}
            loading={loading}
            emptyText="暂无比赛"
            columns={[
              {
                key: 'type',
                label: '类型',
                width: '100px',
                render: (contest) => (
                  <span
                    style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      background: getTypeColor(contest.type),
                      color: 'white'
                    }}
                  >
                    {getTypeLabel(contest.type)}
                  </span>
                )
              },
              {
                key: 'team',
                label: '团队',
                render: (contest) =>
                  contest.team ? (
                    <span style={{ color: 'var(--primary)' }}>{contest.team.name}</span>
                  ) : (
                    <span style={{ color: 'var(--gray-400)' }}>—</span>
                  )
              },
              {
                key: 'title',
                label: '标题',
                render: (contest) => (
                  <Link
                    href={`/teacher/contests/${contest.id}`}
                    style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}
                  >
                    {contest.title}
                  </Link>
                )
              },
              {
                key: 'contestDate',
                label: '比赛日期',
                render: (contest) => new Date(contest.contestDate).toLocaleDateString('zh-CN')
              },
              {
                key: 'status',
                label: '状态',
                render: (contest) => (
                  <Badge
                    variant={
                      contest.status === 'upcoming'
                        ? 'info'
                        : contest.status === 'ongoing'
                        ? 'warning'
                        : 'success'
                    }
                  >
                    {getStatusLabel(contest.status)}
                  </Badge>
                )
              },
              {
                key: 'countRating',
                label: '计Rating',
                render: (contest) => (contest.countRating ? '是' : '否')
              },
              {
                key: 'creator',
                label: '创建者',
                render: (contest) => contest.creator?.username || '-'
              }
            ]}
            actions={(contest) => (
              <>
                <Link
                  href={`/teacher/contests/${contest.id}`}
                  style={{ color: 'var(--primary)', marginRight: '1rem', textDecoration: 'none' }}
                >
                  查看
                </Link>
                <Button
                  variant="text"
                  onClick={() => router.push(`/teacher/contests/${contest.id}/edit`)}
                >
                  ��辑
                </Button>
                <Button
                  variant="text"
                  style={{ color: 'var(--error)' }}
                  onClick={() => handleDelete(contest.id)}
                >
                  删除
                </Button>
              </>
            )}
          />
        </div>
      </div>
    </ProtectedRoute>
  )
}
