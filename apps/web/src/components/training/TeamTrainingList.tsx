'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { TrainingFormModal } from './TrainingFormModal'

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

const STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
  upcoming: { label: '未开始', color: '#3b82f6', dot: '#3b82f6' },
  ongoing: { label: '进行中', color: '#16a34a', dot: '#16a34a' },
  finished: { label: '已结束', color: '#9ca3af', dot: '#9ca3af' },
}

const FORMAT_MAP: Record<string, string> = {
  ioi: 'IOI',
  icpc: 'ICPC',
}

function formatDuration(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  if (h > 0 && m > 0) return `${h}h${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hh}:${mm}`
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

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-400)', fontSize: '0.85rem' }}>加载中...</div>
  }

  if (trainings.length === 0) {
    return (
      <>
        <div style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--gray-400)' }}>
          <div style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>暂无训练</div>
          {isAdmin && (
            <button
              onClick={() => setShowCreateModal(true)}
              style={{
                marginTop: '1rem',
                padding: '0.4rem 1.2rem',
                fontSize: '0.8rem',
                color: 'white',
                background: 'var(--primary)',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              创建训练
            </button>
          )}
        </div>
        <TrainingFormModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          teamId={teamId}
          onSaved={() => { setShowCreateModal(false); fetchTrainings() }}
        />
      </>
    )
  }

  const ongoingCount = trainings.filter(t => t.status === 'ongoing').length

  return (
    <>
      {/* 工具栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '0.75rem',
        padding: '0 2px',
      }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>
          共 {trainings.length} 场训练{ongoingCount > 0 ? `，进行中 ${ongoingCount} 场` : ''}
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowCreateModal(true)}
            style={{
              padding: '0.3rem 0.9rem',
              fontSize: '0.8rem',
              color: 'white',
              background: 'var(--primary)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 500,
              lineHeight: '1.5',
            }}
          >
            + 创建训练
          </button>
        )}
      </div>

      {/* 表格 */}
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '0.84rem',
        background: 'white',
        borderRadius: '6px',
        overflow: 'hidden',
        border: '1px solid #e5e7eb',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '0.55rem 0.75rem', fontWeight: 600, color: '#6b7280', fontSize: '0.76rem' }}>#</th>
            <th style={{ textAlign: 'left', padding: '0.55rem 0.75rem', fontWeight: 600, color: '#6b7280', fontSize: '0.76rem' }}>训练名称</th>
            <th style={{ textAlign: 'center', padding: '0.55rem 0.75rem', fontWeight: 600, color: '#6b7280', fontSize: '0.76rem' }}>赛制</th>
            <th style={{ textAlign: 'center', padding: '0.55rem 0.75rem', fontWeight: 600, color: '#6b7280', fontSize: '0.76rem' }}>状态</th>
            <th style={{ textAlign: 'center', padding: '0.55rem 0.75rem', fontWeight: 600, color: '#6b7280', fontSize: '0.76rem' }}>题数</th>
            <th style={{ textAlign: 'center', padding: '0.55rem 0.75rem', fontWeight: 600, color: '#6b7280', fontSize: '0.76rem' }}>人数</th>
            <th style={{ textAlign: 'left', padding: '0.55rem 0.75rem', fontWeight: 600, color: '#6b7280', fontSize: '0.76rem' }}>开始时间</th>
            <th style={{ textAlign: 'center', padding: '0.55rem 0.75rem', fontWeight: 600, color: '#6b7280', fontSize: '0.76rem' }}>时长</th>
          </tr>
        </thead>
        <tbody>
          {trainings.map((training, idx) => {
            const statusInfo = STATUS_MAP[training.status] || STATUS_MAP.upcoming
            return (
              <tr
                key={training.id}
                onClick={() => router.push(`${basePath}/${teamId}/trainings/${training.id}`)}
                style={{
                  cursor: 'pointer',
                  borderBottom: idx === trainings.length - 1 ? 'none' : '1px solid #f3f4f6',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f9fafb' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {/* 序号 */}
                <td style={{ padding: '0.6rem 0.75rem', color: '#9ca3af', fontSize: '0.78rem', width: '32px' }}>
                  {idx + 1}
                </td>

                {/* 训练名称 */}
                <td style={{ padding: '0.6rem 0.75rem' }}>
                  <span style={{ fontWeight: 600, color: '#111827' }}>{training.title}</span>
                </td>

                {/* 赛制 */}
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '0.1rem 0.4rem',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: training.format === 'ioi' ? '#1d4ed8' : '#7c3aed',
                    background: training.format === 'ioi' ? '#eff6ff' : '#f5f3ff',
                    borderRadius: '3px',
                    letterSpacing: '0.04em',
                  }}>
                    {FORMAT_MAP[training.format] || training.format.toUpperCase()}
                  </span>
                </td>

                {/* 状态 */}
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: statusInfo.color, fontWeight: 500 }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusInfo.dot }} />
                    {statusInfo.label}
                  </span>
                </td>

                {/* 题数 */}
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: '#6b7280' }}>
                  {training.problemCount}
                </td>

                {/* 人数 */}
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: '#6b7280' }}>
                  {training.participantCount}
                </td>

                {/* 开始时间 */}
                <td style={{ padding: '0.6rem 0.75rem', color: '#6b7280', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                  {formatDateTime(training.startTime)}
                </td>

                {/* 时长 */}
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: '#6b7280', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                  {formatDuration(training.startTime, training.endTime)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <TrainingFormModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        teamId={teamId}
        onSaved={() => { setShowCreateModal(false); fetchTrainings() }}
      />
    </>
  )
}
