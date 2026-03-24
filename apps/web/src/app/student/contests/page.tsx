'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { getAuthHeaders } from '@/lib/auth'
import { ENV } from '@/config/env'

interface Contest {
  id: string
  title: string
  description: string | null
  contestDate: string
  status: string
  type: string
  countRating: boolean
}

interface Resource {
  id: string
  fileName: string
  fileType: string
  fileFormat: string
  fileUrl: string
  contestProblemId: string | null
  visibleRoles: string
}

interface ContestProblem {
  id: string
  orderIndex: number
  title: string | null
  description: string | null
  ojName: string | null
  problemId: string | null
  isCustom: boolean
  difficulty: string | null
  points: number | null
  // 题面相关
  statementType: 'none' | 'markdown' | 'pdf'
  statementMarkdown: string | null
  // 题解相关
  solutionType: 'none' | 'markdown' | 'pdf'
  solutionMarkdown: string | null
  solutionVisible: boolean
}

// 排行榜成绩
interface RankItem {
  studentId: string
  studentName: string
  username: string
  totalScore: number
  problemScores: { [problemId: string]: number | null }
  rank: number | null
}

// 学生个人成绩
interface StudentResult {
  rank: number | null
  score: number | null
  ratingBefore: number
  ratingAfter: number
  ratingChange: number
}

export default function StudentContestsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const { logout, user } = useAuth()
  const [contests, setContests] = useState<Contest[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedContest, setSelectedContest] = useState<Contest | null>(null)
  const [resources, setResources] = useState<Resource[]>([])
  const [problems, setProblems] = useState<ContestProblem[]>([])
  const [ranklist, setRanklist] = useState<RankItem[]>([])
  const [studentResult, setStudentResult] = useState<StudentResult | null>(null)
  const [showContestModal, setShowContestModal] = useState(false)
  const [showProblemModal, setShowProblemModal] = useState(false)
  const [selectedProblem, setSelectedProblem] = useState<ContestProblem | null>(null)
  const [activeTab, setActiveTab] = useState<'home' | 'ranklist'>('home')
  const [problemActiveTab, setProblemActiveTab] = useState<'statement' | 'solution'>('statement')
  const [typeFilter, setTypeFilter] = useState('')
  const [loadingMarkdown, setLoadingMarkdown] = useState(false)
  const [statementContent, setStatementContent] = useState('')
  const [solutionContent, setSolutionContent] = useState('')

  useEffect(() => {
    fetchContests()
  }, [typeFilter])

  const fetchContests = async () => {
    try {
      const url = typeFilter ? `/api/contests?type=${typeFilter}&status=finished` : '/api/contests?status=finished'
      const res = await fetch(url, { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) {
        setContests(data.data.list)
      }
    } catch (error) {
      console.error('Failed to fetch contests:', error)
    } finally {
      setLoading(false)
    }
  }

  // 查看比赛详情 - 跳转到独立页面
  const handleViewContest = (contest: Contest) => {
    router.push(`/student/contests/${contest.id}`)
  }

  // 点击题目查看题面
  const handleViewProblem = async (problem: ContestProblem) => {
    setSelectedProblem(problem)
    setProblemActiveTab('statement')
    setStatementContent('')
    setSolutionContent('')
    setShowProblemModal(true)

    // 加载题面内容
    if (problem.statementType === 'markdown' && problem.statementMarkdown) {
      setStatementContent(problem.statementMarkdown)
    } else if (problem.statementType === 'pdf') {
      // PDF 题面通过 resource 获取
      const statementResource = resources.find(
        r => r.contestProblemId === problem.id && r.fileType === 'statement'
      )
      if (statementResource) {
        // PDF 将在题面区域展示
      }
    }

    // 加载题解内容
    if (problem.solutionVisible) {
      if (problem.solutionType === 'markdown' && problem.solutionMarkdown) {
        setSolutionContent(problem.solutionMarkdown)
      }
    }
  }

  // 转换题号：1 -> A, 2 -> B, ...
  const getProblemCode = (index: number): string => {
    return String.fromCharCode(65 + index) // 65 = 'A'
  }

  // 获取题目关联的题面资源
  const getProblemStatementResource = (problemId: string): Resource | undefined => {
    return resources.find(r => r.contestProblemId === problemId && r.fileType === 'statement')
  }

  // 获取题目关联的题解资源
  const getProblemSolutionResource = (problemId: string): Resource | undefined => {
    return resources.find(r => r.contestProblemId === problemId && r.fileType === 'solution')
  }

  // 比赛状态标签
  const getStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      upcoming: '未开始',
      ongoing: '进行中',
      finished: '已结束'
    }
    return labels[status] || status
  }

  // 比赛类型标签
  const getTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      training: '训练赛',
      official: '正赛',
      mock: '模拟赛'
    }
    return labels[type] || type
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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 600 }}>我的比赛</h2>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem' }}
            >
              <option value="">全部类型</option>
              <option value="training">训练赛</option>
              <option value="official">正赛</option>
              <option value="mock">模拟赛</option>
            </select>
          </div>

          {loading ? (
            <p>加载中...</p>
          ) : contests.length === 0 ? (
            <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '3rem', textAlign: 'center', color: 'var(--gray-500)' }}>
              暂无模拟赛记录
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {contests.map(contest => (
                <div
                  key={contest.id}
                  style={{
                    background: 'white',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    padding: '1.5rem',
                    transition: 'box-shadow 0.2s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>{contest.title}</h3>
                    <span style={{ padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', background: contest.type === 'training' ? '#3b82f6' : contest.type === 'official' ? '#8b5cf6' : '#f59e0b', color: 'white' }}>
                      {getTypeLabel(contest.type)}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)', marginBottom: '0.5rem' }}>
                    比赛日期：{new Date(contest.contestDate).toLocaleDateString()}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <span style={{ padding: '0.125rem 0.375rem', borderRadius: '4px', fontSize: '0.75rem', background: contest.status === 'finished' ? 'var(--gray-100)' : 'var(--primary)', color: contest.status === 'finished' ? 'var(--gray-600)' : 'white' }}>
                      {getStatusLabel(contest.status)}
                    </span>
                    {contest.countRating && (
                      <span style={{ fontSize: '0.75rem', color: '#16a34a' }}>✓ 计入 Rating</span>
                    )}
                  </div>
                  {contest.description && (
                    <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.75rem' }}>{contest.description}</p>
                  )}
                  {/* 思路记录入口按钮 */}
                  <button
                    onClick={() => router.push(`/student/contests/${contest.id}`)}
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      background: 'var(--primary)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: 500
                    }}
                  >
                    ✏️ 进入做题 / 思路记录
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 比赛详情弹窗 */}
        {showContestModal && selectedContest && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, overflow: 'auto' }}>
            <div style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', width: '100%', maxWidth: '900px', maxHeight: '90vh', overflow: 'auto' }}>
              {/* 顶部区域 */}
              <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>{selectedContest.title}</h3>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', background: selectedContest.type === 'training' ? '#3b82f6' : selectedContest.type === 'official' ? '#8b5cf6' : '#f59e0b', color: 'white' }}>
                        {getTypeLabel(selectedContest.type)}
                      </span>
                      <span style={{ padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', background: selectedContest.status === 'finished' ? 'var(--gray-100)' : 'var(--primary)', color: selectedContest.status === 'finished' ? 'var(--gray-600)' : 'white' }}>
                        {getStatusLabel(selectedContest.status)}
                      </span>
                      <span style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>
                        {new Date(selectedContest.contestDate).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {studentResult && (
                    <div style={{ textAlign: 'right', padding: '0.75rem', background: 'var(--gray-50)', borderRadius: '8px' }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>我的成绩</p>
                      <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>
                        {studentResult.rank ? `#${studentResult.rank}` : '-'}
                        <span style={{ fontSize: '1rem', color: 'var(--gray-500)', marginLeft: '0.5rem' }}>
                          {studentResult.score ?? '-'}分
                        </span>
                      </p>
                    </div>
                  )}
                </div>
                {selectedContest.description && (
                  <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--gray-600)' }}>{selectedContest.description}</p>
                )}
              </div>

              {/* Tab 切换 */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                <button
                  onClick={() => setActiveTab('home')}
                  style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: activeTab === 'home' ? 'var(--primary)' : 'transparent', color: activeTab === 'home' ? 'white' : 'var(--gray-600)', cursor: 'pointer' }}
                >
                  比赛主页
                </button>
                <button
                  onClick={() => setActiveTab('ranklist')}
                  style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: activeTab === 'ranklist' ? 'var(--primary)' : 'transparent', color: activeTab === 'ranklist' ? 'white' : 'var(--gray-600)', cursor: 'pointer' }}
                >
                  排行榜
                </button>
              </div>

              {/* 比赛主页 Tab */}
              {activeTab === 'home' && (
                <div>
                  {/* 题目列表区域 */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' }}>题目列表</h4>
                    {problems.length === 0 ? (
                      <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)', background: 'var(--gray-50)', borderRadius: '8px' }}>
                        暂无题目
                      </p>
                    ) : (
                      <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ background: 'var(--gray-50)' }}>
                              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500, width: '60px' }}>题号</th>
                              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>题目名称</th>
                              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500, width: '100px' }}>难度</th>
                              <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500, width: '80px' }}>分值</th>
                            </tr>
                          </thead>
                          <tbody>
                            {problems.map((problem, index) => (
                              <tr
                                key={problem.id}
                                onClick={() => handleViewProblem(problem)}
                                style={{ borderTop: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.2s' }}
                                onMouseOver={(e) => e.currentTarget.style.background = 'var(--gray-50)'}
                                onMouseOut={(e) => e.currentTarget.style.background = 'white'}
                              >
                                <td style={{ padding: '0.75rem 1rem', fontSize: '1rem', fontWeight: 600, color: 'var(--primary)' }}>
                                  {getProblemCode(problem.orderIndex - 1)}
                                </td>
                                <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                                  {problem.isCustom ? problem.title : `${problem.ojName} ${problem.problemId}`}
                                </td>
                                <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem' }}>
                                  {problem.difficulty && (
                                    <span style={{
                                      padding: '0.125rem 0.375rem',
                                      borderRadius: '4px',
                                      fontSize: '0.75rem',
                                      background: problem.difficulty === '困难' ? '#fee2e2' : problem.difficulty === '中等' ? '#fef3c7' : '#dcfce7',
                                      color: problem.difficulty === '困难' ? '#dc2626' : problem.difficulty === '中等' ? '#d97706' : '#16a34a'
                                    }}>
                                      {problem.difficulty}
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '0.75rem 1rem', fontSize: '0.875rem', color: 'var(--gray-500)' }}>
                                  {problem.points ?? '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* 比赛级附件 */}
                  {resources.filter(r => !r.contestProblemId).length > 0 && (
                    <div>
                      <h4 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' }}>比赛附件</h4>
                      <div style={{ display: 'grid', gap: '0.5rem' }}>
                        {resources.filter(r => !r.contestProblemId).map(resource => (
                          <div
                            key={resource.id}
                            onClick={() => {
                              if (resource.fileFormat === 'markdown') {
                                // 打开 markdown 查看
                              } else {
                                window.open(`${ENV.API_URL}${resource.fileUrl}`, '_blank')
                              }
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                              padding: '0.75rem',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              background: 'var(--gray-50)'
                            }}
                          >
                            <span style={{ fontSize: '1.25rem' }}>📄</span>
                            <span style={{ flex: 1, fontSize: '0.875rem' }}>{resource.fileName}</span>
                            <span style={{ fontSize: '0.75rem', color: resource.fileFormat === 'markdown' ? '#1e40af' : '#6b7280' }}>
                              {resource.fileFormat === 'markdown' ? 'Markdown' : 'PDF'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 排行榜 Tab */}
              {activeTab === 'ranklist' && (
                <div>
                  {ranklist.length === 0 ? (
                    <p style={{ padding: '3rem', textAlign: 'center', color: 'var(--gray-500)', background: 'var(--gray-50)', borderRadius: '8px' }}>
                      暂无排行榜数据
                    </p>
                  ) : (
                    <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'auto', maxHeight: '500px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: 'var(--gray-50)', position: 'sticky', top: 0 }}>
                            <th style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: 500, width: '60px' }}>排名</th>
                            <th style={{ padding: '0.75rem', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>学生</th>
                            <th style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: 500, width: '80px' }}>总分</th>
                            {problems.map((problem, index) => (
                              <th key={problem.id} style={{ padding: '0.5rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: 500, minWidth: '50px' }}>
                                {getProblemCode(problem.orderIndex - 1)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ranklist.map((item, index) => (
                            <tr key={item.studentId} style={{ borderTop: '1px solid var(--border)', background: index % 2 === 0 ? 'white' : 'var(--gray-50)' }}>
                              <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600 }}>
                                {item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : item.rank || '-'}
                              </td>
                              <td style={{ padding: '0.5rem', fontSize: '0.875rem' }}>
                                <div>{item.studentName}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>{item.username}</div>
                              </td>
                              <td style={{ padding: '0.5rem', textAlign: 'center', fontWeight: 600, color: 'var(--primary)' }}>
                                {item.totalScore ?? 0}
                              </td>
                              {problems.map(problem => (
                                <td key={problem.id} style={{ padding: '0.5rem', textAlign: 'center', fontSize: '0.875rem' }}>
                                  {item.problemScores[problem.id] ?? '-'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <button onClick={() => setShowContestModal(false)} style={{ marginTop: '1.5rem', width: '100%', padding: '0.625rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'white' }}>关闭</button>
            </div>
          </div>
        )}

        {/* 题目详情弹窗 */}
        {showProblemModal && selectedProblem && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, overflow: 'auto' }}>
            <div style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', width: '100%', maxWidth: '800px', maxHeight: '90vh', overflow: 'auto' }}>
              {/* 顶部区域 */}
              <div style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)', marginRight: '0.5rem' }}>
                      {getProblemCode(selectedProblem.orderIndex - 1)}.
                    </span>
                    <span style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                      {selectedProblem.isCustom ? selectedProblem.title : `${selectedProblem.ojName} ${selectedProblem.problemId}`}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowProblemModal(false)}
                    style={{ padding: '0.25rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px', background: 'white', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  {selectedProblem.difficulty && (
                    <span style={{ padding: '0.125rem 0.375rem', borderRadius: '4px', fontSize: '0.75rem', background: '#dcfce7', color: '#16a34a' }}>
                      {selectedProblem.difficulty}
                    </span>
                  )}
                  {selectedProblem.points && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>{selectedProblem.points} 分</span>
                  )}
                </div>
              </div>

              {/* 二级导航 */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                <button
                  onClick={() => setProblemActiveTab('statement')}
                  style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: problemActiveTab === 'statement' ? 'var(--primary)' : 'transparent', color: problemActiveTab === 'statement' ? 'white' : 'var(--gray-600)', cursor: 'pointer' }}
                >
                  描述
                </button>
                {selectedProblem.solutionVisible && (
                  <button
                    onClick={() => setProblemActiveTab('solution')}
                    style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: problemActiveTab === 'solution' ? 'var(--primary)' : 'transparent', color: problemActiveTab === 'solution' ? 'white' : 'var(--gray-600)', cursor: 'pointer' }}
                  >
                    题解
                  </button>
                )}
                <button
                  onClick={() => setShowProblemModal(false)}
                  style={{ marginLeft: 'auto', padding: '0.5rem 1rem', border: '1px solid var(--border)', borderRadius: '6px', background: 'white', fontSize: '0.875rem' }}
                >
                  返回比赛
                </button>
              </div>

              {/* 题面内容 */}
              {problemActiveTab === 'statement' && (
                <div>
                  {/* Markdown 题面 */}
                  {(selectedProblem.statementType === 'markdown' && statementContent) && (
                    <div style={{ padding: '1rem', background: 'var(--gray-50)', borderRadius: '8px', border: '1px solid var(--border)', minHeight: '200px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.875rem', lineHeight: 1.6 }}>
                      {statementContent}
                    </div>
                  )}

                  {/* PDF 题面 */}
                  {(selectedProblem.statementType === 'pdf' || (!selectedProblem.statementType || selectedProblem.statementType === 'none')) && (
                    getProblemStatementResource(selectedProblem.id) ? (
                      <div style={{ minHeight: '500px' }}>
                        <iframe
                          src={`${ENV.API_URL}${getProblemStatementResource(selectedProblem.id)?.fileUrl}`}
                          style={{ width: '100%', height: '500px', border: 'none', borderRadius: '8px' }}
                          title="题面 PDF"
                        />
                      </div>
                    ) : (
                      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--gray-500)', background: 'var(--gray-50)', borderRadius: '8px' }}>
                        题面暂未发布
                      </div>
                    )
                  )}
                </div>
              )}

              {/* 题解内容 */}
              {problemActiveTab === 'solution' && selectedProblem.solutionVisible && (
                <div>
                  {/* Markdown 题解 */}
                  {(selectedProblem.solutionType === 'markdown' && solutionContent) && (
                    <div style={{ padding: '1rem', background: 'var(--gray-50)', borderRadius: '8px', border: '1px solid var(--border)', minHeight: '200px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.875rem', lineHeight: 1.6 }}>
                      {solutionContent}
                    </div>
                  )}

                  {/* PDF 题解 */}
                  {selectedProblem.solutionType === 'pdf' && (
                    getProblemSolutionResource(selectedProblem.id) ? (
                      <div style={{ minHeight: '500px' }}>
                        <iframe
                          src={`${ENV.API_URL}${getProblemSolutionResource(selectedProblem.id)?.fileUrl}`}
                          style={{ width: '100%', height: '500px', border: 'none', borderRadius: '8px' }}
                          title="题解 PDF"
                        />
                      </div>
                    ) : (
                      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--gray-500)', background: 'var(--gray-50)', borderRadius: '8px' }}>
                        题解暂未发布
                      </div>
                    )
                  )}

                  {/* 无题解 */}
                  {(!selectedProblem.solutionType || selectedProblem.solutionType === 'none') && (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--gray-500)', background: 'var(--gray-50)', borderRadius: '8px' }}>
                      暂无题解
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  )
}
