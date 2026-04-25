'use client'

import { useEffect, useState } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import apiClient from '@/lib/apiClient'
import { getUserId } from '@/lib/auth'

interface ContestResult {
  id: string
  rank: number | null
  score: number | null
  ratingBefore: number
  ratingAfter: number
  ratingChange: number
  contest: {
    id: string
    title: string
    type: string
    contestDate: string
    countRating: boolean
  }
}

export default function StudentRatingPage() {
  const [currentRating, setCurrentRating] = useState(1200)
  const [contestResults, setContestResults] = useState<ContestResult[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchRatingHistory()
  }, [])

  const fetchRatingHistory = async () => {
    const userId = getUserId()
    if (!userId) return

    try {
      const result = await apiClient.get<{ rating: number; contestResults: ContestResult[] }>(`/api/students/${userId}`)
      if (result.success && result.data) {
        setCurrentRating(result.data.rating || 1200)
        // 只保留计rating的比赛
        const ratingContests = (result.data.contestResults || []).filter(
          (r: ContestResult) => r.contest.countRating
        )
        setContestResults(ratingContests)
      }
    } catch (error) {
      console.error('Failed to fetch rating history:', error)
    } finally {
      setLoading(false)
    }
  }

  const contestTypeLabels: Record<string, string> = {
    training: '训练赛',
    official: '正赛',
    mock: '模拟赛'
  }

  // 计算统计信息
  const totalContests = contestResults.length
  const wins = contestResults.filter(r => r.rank === 1).length
  const avgRank = totalContests > 0
    ? (contestResults.reduce((sum, r) => sum + (r.rank || 0), 0) / totalContests).toFixed(1)
    : '-'
  const totalChange = contestResults.reduce((sum, r) => sum + r.ratingChange, 0)

  return (
    <ProtectedRoute requiredRole="student">
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
          {/* Rating 概览 */}
          <div style={{ background: 'var(--primary)', borderRadius: 'var(--radius-lg)', padding: '2rem', marginBottom: '1.5rem', color: 'white' }}>
            <p style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '0.5rem' }}>当前 Rating</p>
            <p style={{ fontSize: '4rem', fontWeight: 700, marginBottom: '1rem' }}>{currentRating}</p>
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                <p style={{ fontSize: '0.75rem', opacity: 0.8 }}>总变化</p>
                <p style={{ fontSize: '1.25rem', fontWeight: 600 }}>{totalChange >= 0 ? '+' : ''}{totalChange}</p>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', opacity: 0.8 }}>参赛次数</p>
                <p style={{ fontSize: '1.25rem', fontWeight: 600 }}>{totalContests}</p>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', opacity: 0.8 }}>冠军次数</p>
                <p style={{ fontSize: '1.25rem', fontWeight: 600 }}>{wins}</p>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', opacity: 0.8 }}>平均排名</p>
                <p style={{ fontSize: '1.25rem', fontWeight: 600 }}>{avgRank}</p>
              </div>
            </div>
          </div>

          {/* Rating 趋势图（简化版） */}
          <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem', marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Rating 趋势</h3>
            {loading ? (
              <p style={{ color: 'var(--gray-500)', textAlign: 'center', padding: '2rem' }}>加载中...</p>
            ) : contestResults.length === 0 ? (
              <p style={{ color: 'var(--gray-500)', textAlign: 'center', padding: '2rem' }}>暂无Rating记录</p>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', height: '150px', padding: '1rem 0' }}>
                {(() => {
                  const minRating = Math.min(...contestResults.map(r => r.ratingBefore), currentRating) - 50
                  const maxRating = Math.max(...contestResults.map(r => r.ratingAfter), currentRating) + 50
                  return contestResults.map((result, index) => {
                    const height = ((result.ratingAfter - minRating) / (maxRating - minRating)) * 100
                    const isUp = result.ratingChange > 0

                    return (
                    <div
                      key={result.id}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.25rem'
                      }}
                      title={`${result.contest.title}: ${result.ratingBefore} → ${result.ratingAfter} (${result.ratingChange >= 0 ? '+' : ''}${result.ratingChange})`}
                    >
                      <div
                        style={{
                          width: '100%',
                          height: `${Math.max(height, 10)}%`,
                          background: isUp ? 'var(--success)' : 'var(--error)',
                          borderRadius: '2px',
                          minHeight: '4px'
                        }}
                      />
                      <span style={{ fontSize: '0.625rem', color: 'var(--gray-400)' }}>#{index + 1}</span>
                    </div>
                  )
                  })
                })()}
                {/* 当前rating */}
                <div
                  style={{
                    flex: 0.5,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}
                  title={`当前: ${currentRating}`}
                >
                  <div
                    style={{
                      width: '100%',
                      height: `${(() => {
                        const minR = Math.min(...contestResults.map(r => r.ratingBefore), currentRating) - 50
                        const maxR = Math.max(...contestResults.map(r => r.ratingAfter), currentRating) + 50
                        return ((currentRating - minR) / (maxR - minR)) * 100
                      })()}%`,
                      background: 'var(--primary)',
                      borderRadius: '2px',
                      minHeight: '4px'
                    }}
                  />
                  <span style={{ fontSize: '0.625rem', color: 'var(--gray-400)' }}>现在</span>
                </div>
              </div>
            )}
          </div>

          {/* 比赛历史 */}
          <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>比赛历史</h3>
            </div>
            {loading ? (
              <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>加载中...</p>
            ) : contestResults.length === 0 ? (
              <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>暂无比赛记录</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--gray-50)' }}>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>比赛</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>类型</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>赛前</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>赛后</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>变化</th>
                    <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>排名</th>
                  </tr>
                </thead>
                <tbody>
                  {contestResults.map(result => (
                    <tr key={result.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{result.contest.title}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                        <span style={{ padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', background: result.contest.type === 'training' ? 'var(--primary)' : result.contest.type === 'official' ? 'var(--primary)' : 'var(--warning)', color: 'white' }}>
                          {contestTypeLabels[result.contest.type]}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{result.ratingBefore}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 600 }}>{result.ratingAfter}</td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 600, color: result.ratingChange >= 0 ? 'var(--success)' : 'var(--error)' }}>
                        {result.ratingChange >= 0 ? '+' : ''}{result.ratingChange}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>#{result.rank || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
    </ProtectedRoute>
  )
}
