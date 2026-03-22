'use client'

import { useEffect, useState } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { getAuthHeaders, getUserId } from '@/lib/auth'

interface ExamScore {
  id: string
  totalScore: number | null
  rank: number | null
  remark: string | null
  exam: {
    id: string
    name: string
    type: string
    examDate: string
  }
}

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

interface StudentProfile {
  rating: number
  examScores: ExamScore[]
  contestResults: ContestResult[]
}

export default function StudentScoresPage() {
  const [profile, setProfile] = useState<StudentProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'exam' | 'contest'>('contest')

  useEffect(() => {
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    const userId = getUserId()
    if (!userId) return

    try {
      const res = await fetch(`http://localhost:3001/api/students/${userId}`, {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success && data.data) {
        setProfile({
          rating: data.data.rating || 1200,
          examScores: data.data.examScores || [],
          contestResults: data.data.contestResults || []
        })
      }
    } catch (error) {
      console.error('Failed to fetch profile:', error)
    } finally {
      setLoading(false)
    }
  }

  const examTypeLabels: Record<string, string> = {
    weekly: '周测',
    monthly: '月测',
    topic: '专题测',
    contest: '模拟赛'
  }

  const contestTypeLabels: Record<string, string> = {
    training: '训练赛',
    official: '正赛',
    mock: '模拟赛'
  }

  // 获取最近的 rating 变化
  const recentContests = profile?.contestResults.slice(0, 5) || []

  return (
    <ProtectedRoute requiredRole="student">
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
          {/* Rating 卡片 */}
          <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: '12px', padding: '2rem', marginBottom: '1.5rem', color: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontSize: '0.875rem', opacity: 0.9, marginBottom: '0.25rem' }}>当前 Rating</p>
                <p style={{ fontSize: '3rem', fontWeight: 700 }}>{profile?.rating || 1200}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '0.875rem', opacity: 0.9 }}>最近变化</p>
                {recentContests.length > 0 && (
                  <p style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                    {recentContests[0].ratingChange >= 0 ? '+' : ''}{recentContests[0].ratingChange}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Tab 切换 */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
            <button
              onClick={() => setActiveTab('contest')}
              style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: activeTab === 'contest' ? 'var(--primary)' : 'transparent', color: activeTab === 'contest' ? 'white' : 'var(--gray-600)', cursor: 'pointer' }}
            >
              比赛成绩
            </button>
            <button
              onClick={() => setActiveTab('exam')}
              style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: activeTab === 'exam' ? 'var(--primary)' : 'transparent', color: activeTab === 'exam' ? 'white' : 'var(--gray-600)', cursor: 'pointer' }}
            >
              考试成绩
            </button>
          </div>

          {loading ? (
            <p>加载中...</p>
          ) : activeTab === 'contest' ? (
            // 比赛成绩
            profile?.contestResults && profile.contestResults.length > 0 ? (
              <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--gray-50)' }}>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>比赛名称</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>类型</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>比赛日期</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>得分</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>排名</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>Rating变化</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.contestResults.map(result => (
                      <tr key={result.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{result.contest.title}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                          <span style={{ padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', background: result.contest.type === 'training' ? '#3b82f6' : result.contest.type === 'official' ? '#8b5cf6' : '#f59e0b', color: 'white' }}>
                            {contestTypeLabels[result.contest.type] || result.contest.type}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{new Date(result.contest.contestDate).toLocaleDateString()}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 600 }}>{result.score ?? '-'}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{result.rank || '-'}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 600, color: result.ratingChange >= 0 ? '#16a34a' : '#dc2626' }}>
                          {result.ratingChange >= 0 ? '+' : ''}{result.ratingChange}
                          {result.contest.countRating && <span style={{ fontSize: '0.7rem', marginLeft: '0.25rem', opacity: 0.7 }}>计Rating</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '3rem', textAlign: 'center', color: 'var(--gray-500)' }}>
                暂无比赛成绩记录
              </div>
            )
          ) : (
            // 考试成绩
            profile?.examScores && profile.examScores.length > 0 ? (
              <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--gray-50)' }}>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>考试名称</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>类型</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>考试日期</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>成绩</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>排名</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.examScores.map(score => (
                      <tr key={score.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{score.exam.name}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{examTypeLabels[score.exam.type] || score.exam.type}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{new Date(score.exam.examDate).toLocaleDateString()}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', fontWeight: 600, color: score.totalScore !== null ? 'var(--primary)' : 'inherit' }}>
                          {score.totalScore !== null ? score.totalScore : '-'}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>{score.rank || '-'}</td>
                        <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: 'var(--gray-500)' }}>{score.remark || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '3rem', textAlign: 'center', color: 'var(--gray-500)' }}>
                暂无考试成绩记录
              </div>
            )
          )}
        </div>
    </ProtectedRoute>
  )
}
