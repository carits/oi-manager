'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { Button } from '@/components/ui/Button'
import { TrainingCreateModal } from './TrainingCreateModal'

interface Training {
  id: string
  title: string
  description: string | null
  format: string
  startTime: string
  endTime: string
  status: string
  createdBy: string
  problemCount: number
  participantCount: number
  createdAt: string
}

interface TeamTrainingListProps {
  teamId: string
  basePath: string
  isAdmin: boolean
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  upcoming: { label: '未开始', color: '#1e40af', bg: '#dbeafe' },
  ongoing: { label: '进行中', color: '#166534', bg: '#dcfce7' },
  finished: { label: '已结束', color: '#6b7280', bg: '#f3f4f6' },
}

const FORMAT_MAP: Record<string, string> = {
  ioi: 'IOI',
  icpc: 'ICPC',
}

export default function TeamTrainingList({ teamId, basePath, isAdmin }: TeamTrainingListProps) {
  const router = useRouter()
  const [trainings, setTrainings] = useState<Training[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const fetchTrainings = useCallback(async () => {
    try {
      const result = await apiClient.get<Training[]>(`/api/teams/${teamId}/trainings`)
      if (result.success) {
        setTrainings(result.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch trainings:', error)
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => {
    fetchTrainings()
  }, [fetchTrainings])

  const getTrainingUrl = (trainingId: string) => {
    return `${basePath}/${teamId}/trainings/${trainingId}`
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>加载中...</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>训练</h2>
        {isAdmin && (
          <Button onClick={() => setShowCreateModal(true)}>
            + 创建训练
          </Button>
        )}
      </div>

      {trainings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>
          <p>暂无训练</p>
          {isAdmin && <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>点击「创建训练」开始</p>}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {trainings.map(training => {
            const statusInfo = STATUS_MAP[training.status] || STATUS_MAP.upcoming
            return (
              <div
                key={training.id}
                onClick={() => router.push(getTrainingUrl(training.id))}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '1rem',
                  background: 'white',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{training.title}</h3>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '0.125rem 0.5rem',
                    borderRadius: '4px',
                    background: statusInfo.bg,
                    color: statusInfo.color,
                    whiteSpace: 'nowrap',
                  }}>
                    {statusInfo.label}
                  </span>
                </div>

                {training.description && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--gray-500)', margin: '0 0 0.5rem 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {training.description}
                  </p>
                )}

                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: '0.5rem' }}>
                  <span style={{ padding: '0.1rem 0.4rem', background: '#f3f4f6', borderRadius: '3px' }}>
                    {FORMAT_MAP[training.format] || training.format}
                  </span>
                  <span>{training.problemCount} 题</span>
                  <span>{training.participantCount} 人参与</span>
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: '0.5rem' }}>
                  {new Date(training.startTime).toLocaleString('zh-CN')} ~ {new Date(training.endTime).toLocaleString('zh-CN')}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <TrainingCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        teamId={teamId}
        onCreated={(trainingId) => {
          setShowCreateModal(false)
          fetchTrainings()
          router.push(getTrainingUrl(trainingId))
        }}
      />
    </div>
  )
}
