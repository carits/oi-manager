'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { TrainingFormModal } from './TrainingFormModal'
import { typeLabel } from './types'

interface Training {
  id: string
  title: string
  description: string | null
  format: string
  type: string
  startTime: string
  endTime: string
  status: string
  createdBy: string
  problemCount: number
  participantCount: number
  createdAt: string
}

interface TeamTrainingListProps {
  teamId?: string
  schoolId?: string
  basePath: string
  isAdmin: boolean
  mode?: 'training' | 'contest' | 'homework'
}

const STATUS_MAP: Record<string, { label: string; color: string; dot: string }> = {
  upcoming: { label: '未开始', color: 'var(--info)', dot: 'var(--info)' },
  ongoing: { label: '进行中', color: 'var(--success)', dot: 'var(--success)' },
  finished: { label: '已结束', color: 'var(--text-muted)', dot: 'var(--text-muted)' },
}

const FORMAT_MAP: Record<string, string> = {
  oi: 'OI',
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

export default function TeamTrainingList({ teamId, schoolId, basePath, isAdmin, mode = 'training' }: TeamTrainingListProps) {
  const router = useRouter()
  const [trainings, setTrainings] = useState<Training[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const fetchTrainings = useCallback(async () => {
    try {
      const url = schoolId
        ? `/api/schools/${schoolId}/contests?type=${mode}`
        : `/api/teams/${teamId}/trainings?type=${mode}`
      const result = await apiClient.get<Training[]>(url)
      if (result.success) {
        setTrainings(result.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch trainings:', error)
    } finally {
      setLoading(false)
    }
  }, [teamId, schoolId, mode])

  useEffect(() => {
    fetchTrainings()
  }, [fetchTrainings])

  // Auto-refresh when upcoming/ongoing trainings exist
  useEffect(() => {
    const hasActive = trainings.some(t => t.status === 'upcoming' || t.status === 'ongoing')
    if (!hasActive) return
    const timer = setInterval(fetchTrainings, 30000)
    return () => clearInterval(timer)
  }, [trainings, fetchTrainings])

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-400)', fontSize: '0.85rem' }}>加载中...</div>
  }

  if (trainings.length === 0) {
    return (
      <>
        <div style={{ textAlign: 'center', padding: '5rem 2rem', color: 'var(--gray-400)' }}>
          <div style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>暂无{typeLabel(mode)}</div>
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
              创建{typeLabel(mode)}
            </button>
          )}
        </div>
        <TrainingFormModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          teamId={teamId}
          schoolId={schoolId}
          onSaved={() => { setShowCreateModal(false); fetchTrainings() }}
          mode={mode}
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
          共 {trainings.length} 场{typeLabel(mode)}{ongoingCount > 0 ? `，进行中 ${ongoingCount} 场` : ''}
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
            + 创建{typeLabel(mode)}
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
          <tr style={{ background: 'var(--bg-muted)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '0.55rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>#</th>
            <th style={{ textAlign: 'left', padding: '0.55rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>{typeLabel(mode)}名称</th>
            <th style={{ textAlign: 'center', padding: '0.55rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>赛制</th>
            <th style={{ textAlign: 'center', padding: '0.55rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>状态</th>
            <th style={{ textAlign: 'center', padding: '0.55rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>题数</th>
            <th style={{ textAlign: 'center', padding: '0.55rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>人数</th>
            <th style={{ textAlign: 'left', padding: '0.55rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>开始时间</th>
            <th style={{ textAlign: 'center', padding: '0.55rem 0.75rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: 'var(--text-xs)' }}>时长</th>
          </tr>
        </thead>
        <tbody>
          {trainings.map((training, idx) => {
            const statusInfo = STATUS_MAP[training.status] || STATUS_MAP.upcoming
            const detailPath =
              mode === 'contest' ? 'contests' :
              mode === 'homework' ? 'homeworks' :
              'trainings'
            const trainingHref = schoolId
              ? `${basePath}/${detailPath}/${training.id}`
              : `${basePath}/${teamId}/${detailPath}/${training.id}`
            const openTraining = () => router.push(trainingHref)
            return (
              <tr
                key={training.id}
                role="link"
                tabIndex={0}
                aria-label={`打开${typeLabel(mode)}：${training.title}`}
                onClick={openTraining}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openTraining()
                  }
                }}
                style={{
                  cursor: 'pointer',
                  borderBottom: idx === trainings.length - 1 ? 'none' : '1px solid #f3f4f6',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {/* 序号 */}
                <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', width: '32px' }}>
                  {idx + 1}
                </td>

                {/* 训练名称 */}
                <td style={{ padding: '0.6rem 0.75rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{training.title}</span>
                </td>

                {/* 赛制 */}
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '0.1rem 0.4rem',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: training.format === 'ioi' ? 'var(--info-text)' : 'var(--text-secondary)',
                    background: training.format === 'ioi' ? 'var(--info-light)' : 'var(--bg-muted)',
                    borderRadius: 'var(--radius-sm)',
                    letterSpacing: '0.04em',
                  }}>
                    {FORMAT_MAP[training.format] || training.format.toUpperCase()}
                  </span>
                </td>

                {/* 状态 */}
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: 'var(--text-sm)', color: statusInfo.color, fontWeight: 500 }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusInfo.dot }} />
                    {statusInfo.label}
                  </span>
                </td>

                {/* 题数 */}
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  {training.problemCount}
                </td>

                {/* 人数 */}
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  {training.participantCount}
                </td>

                {/* 开始时间 */}
                <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>
                  {formatDateTime(training.startTime)}
                </td>

                {/* 时长 */}
                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap' }}>
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
        schoolId={schoolId}
        onSaved={() => { setShowCreateModal(false); fetchTrainings() }}
        mode={mode}
      />
    </>
  )
}
